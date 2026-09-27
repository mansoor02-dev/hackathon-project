import app from "./app/app.js";
import { port } from "./config/config.js";

app.listen(port, () => {
  console.log(`Graph8 Ghost Ops Server running on port ${port}`);
  console.log("Listening for Signals & Calendar Webhooks...");
});