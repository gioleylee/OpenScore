import { spawn } from "node:child_process";
import path from "node:path";
import { copyFile, mkdir } from "node:fs/promises";
const mode = process.argv[2];
if (!["debug", "release"].includes(mode))
  throw new Error("Choose debug or release");
const java = process.env.JAVA_HOME
  ? path.join(
      process.env.JAVA_HOME,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    )
  : "java";
const command =
  mode === "debug" ? ":app:assembleDebug" : ":app:assembleRelease";
const child = spawn(
  java,
  [
    "-classpath",
    "gradle/wrapper/gradle-wrapper.jar",
    "org.gradle.wrapper.GradleWrapperMain",
    command,
    "--no-daemon",
  ],
  { cwd: path.resolve("android"), stdio: "inherit", env: process.env },
);
child.on("error", (error) => {
  console.error(
    "Android build requires JDK 21 and Android SDK 36. See docs/ANDROID.md.",
    error.message,
  );
  process.exitCode = 1;
});
child.on("exit", async (code) => {
  if (code !== 0) {
    process.exitCode = code || 1;
    return;
  }
  try {
    const output = path.resolve("../artifacts");
    await mkdir(output, { recursive: true });
    const name = `openscore-ai-${mode}.apk`;
    await copyFile(
      path.resolve(`android/app/build/outputs/apk/${mode}/app-${mode}.apk`),
      path.join(output, name),
    );
    console.log(`APK saved to ${path.join(output, name)}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
});
