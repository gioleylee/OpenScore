import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { initializePlatform } from "./platform";
initializePlatform()
  .then(() => createRoot(document.getElementById("root")!).render(<App />))
  .catch((error) => {
    document.getElementById("root")!.textContent =
      `Could not open device settings: ${String(error)}. Check that app storage is available.`;
  });
