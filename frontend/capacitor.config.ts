import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "org.openscoreai.app",
  appName: "OpenScore AI",
  webDir: "dist",
  server: { androidScheme: "https" },
  android: { allowMixedContent: false },
  plugins: { CapacitorHttp: { enabled: false } },
};
export default config;
