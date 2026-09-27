import { recordEvent } from "../event-store.js";
import { getOpportunity, upsertOpportunity, isContactEnrolled, markContactEnrolled } from "./store.js";
import { verifyContactEmail, enrichContact, discoverContact } from "./discovery.js";
import { enrollContact, sequenceStatus } from "../graph8/sequences-service.js";
import { ensureRecoveryList, addToRecoveryList } from "../graph8/lists-service.js";
import { createRecoveryTask } from "../graph8/tasks-service.js";

// Full recovery pipeline with re-check + idempotency:
//   opportunity -> re-check meeting -> discovery -> enrichment ->
//   verification -> list -> sequence (or Ready for Sequence).
// `meetingBookedFor(domain)` must return true when a meeting has since
// been booked — in that case recovery is cancelled, never enrolled.
export async function processRecovery({
  domain,
  companyName = null,
  companyId = null,
  intentScore = null,
  meetingBookedFor = null,
} = {}) {
  const key = String(domain || "").toLowerCase();
  if (!key) return { status: "not_eligible", reason: "missing domain" };

  if (typeof meetingBookedFor === "function" && meetingBookedFor(key)) {
    upsertOpportunity(key, {
      status: "cancelled",
      timelineEvent: "recovery_cancelled",
      timelineDetail: "meeting booked before enrollment",
    });
    recordEvent("recovery_cancelled", { company: companyName, domain: key, metadata: { reason: "meeting booked" } });
    return { status: "cancelled", reason: "meeting has since been booked" };
  }

  let opp = getOpportunity(key);
  if (!opp) {
    opp = upsertOpportunity(key, {
      company: companyName,
      companyId,
      intentScore,
      status: "candidate",
      recoveryEligible: true,
      timelineEvent: "recovery_created",
      timelineDetail: `Intent ${intentScore}`,
    });
    recordEvent("recovery_created", { company: companyName, domain: key, metadata: { intentScore } });
  }

  // 1. Contact discovery.
  if (!opp.contact) {
    const found = await discoverContact({ domain: key, companyName, companyId });
    if (!found.contact) {
      upsertOpportunity(key, {
        status: "needs_research",
        timelineEvent: "contact_not_found",
        timelineDetail: found.reason || "no suitable contact",
      });
      recordEvent("recovery_no_contact", { company: companyName, domain: key, metadata: { reason: found.reason } });
      // Fallback: Graph8 task so the signal never disappears silently.
      await createRecoveryTask({
        contactId: null,
        title: `Research ${companyName || key} — high-intent inbound account`,
        description: `High-intent inbound account (${key}) has no reliable contact. Research a relevant buyer.`,
      }).catch(() => null);
      recordEvent("recovery_task_created", { company: companyName, domain: key, metadata: {} });
      return { status: "needs_research", reason: found.reason || "no suitable contact" };
    }
    upsertOpportunity(key, {
      contact: found.contact,
      contactSource: found.source,
      status: "contact_found",
      timelineEvent: "contact_discovered",
      timelineDetail: found.contact.email || found.contact.name,
    });
    recordEvent("recovery_contact_found", { company: companyName, domain: key, metadata: { contact: found.contact.email } });
    opp = getOpportunity(key);
  }

  // 2. Enrichment (lookup -> enrich only when missing).
  if (!opp.enriched) {
    const { contact, mode } = await enrichContact(opp.contact);
    upsertOpportunity(key, {
      contact,
      enriched: mode !== "ERROR",
      enrichmentMode: mode,
      status: "enriched",
      timelineEvent: "contact_enriched",
      timelineDetail: mode,
    });
    recordEvent("recovery_contact_enriched", { company: companyName, domain: key, metadata: { mode } });
    opp = getOpportunity(key);
  }

  // 3. Email verification gate.
  if (!opp.verification) {
    if (!opp.contact?.email) {
      upsertOpportunity(key, { status: "needs_research", timelineEvent: "email_unavailable" });
      return { status: "needs_research", reason: "email unavailable" };
    }
    const verification = await verifyContactEmail(opp.contact.email);
    upsertOpportunity(key, {
      verification,
      status: verification.eligible ? "verified" : "needs_research",
      timelineEvent: "email_verified",
      timelineDetail: verification.state,
    });
    recordEvent("recovery_email_verified", { company: companyName, domain: key, metadata: verification });
    if (!verification.eligible) {
      return { status: "needs_research", reason: `email ${verification.state}` };
    }
    opp = getOpportunity(key);
  }

  // 4. Recovery list segmentation.
  const list = await ensureRecoveryList().catch(() => ({ id: null }));
  if (list?.id && opp.contact?.id) {
    await addToRecoveryList(opp.contact.id, list.id).catch(() => null);
  }

  // 5. Re-check meeting immediately before enrollment.
  if (typeof meetingBookedFor === "function" && meetingBookedFor(key)) {
    upsertOpportunity(key, { status: "cancelled", timelineEvent: "recovery_cancelled", timelineDetail: "meeting booked at enroll time" });
    return { status: "cancelled", reason: "meeting booked before enrollment" };
  }

  // 6. Idempotency: never enroll twice.
  const contactId = opp.contact?.id || opp.contact?.email;
  if (contactId && isContactEnrolled(key, opp.contact?.id)) {
    return { status: "already_enrolled", domain: key, sequenceId: opp.sequenceId || null };
  }

  // 7. Sequencer (real enroll only when explicitly enabled).
  const seq = sequenceStatus();
  if (seq.mode === "NOT_CONFIGURED") {
    upsertOpportunity(key, { status: "ready_no_sequence", timelineEvent: "sequence_not_configured" });
    return { status: "ready_no_sequence", reason: "Sequence not configured", domain: key };
  }
  const result = await enrollContact(opp.contact?.id || opp.contact?.email, {
    idempotencyKey: `recovery:${key}:${opp.contact?.id || opp.contact?.email}`,
  });
  if (result.enrolled) {
    markContactEnrolled(key, opp.contact?.id || opp.contact?.email, result.sequenceId);
    recordEvent("recovery_enrolled", { company: companyName, domain: key, metadata: { sequenceId: result.sequenceId } });
    return { status: "enrolled", domain: key, sequenceId: result.sequenceId };
  }
  if (result.mode === "DRY_RUN" || result.needsCrmContact) {
    upsertOpportunity(key, {
      status: "ready_for_sequence",
      sequenceId: result.sequenceId || null,
      timelineEvent: "ready_for_sequence",
      timelineDetail: result.needsCrmContact ? result.reason : `Would enroll into ${result.sequenceId || "Inbound Recovery"}`,
    });
    return { status: "ready_for_sequence", reason: result.reason, domain: key, sequenceId: result.sequenceId || null };
  }
  recordEvent("error", { metadata: { where: "recovery_enroll", message: result.reason, domain: key } });
  return { status: "enroll_failed", reason: result.reason, domain: key };
}
