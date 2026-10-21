import path from "node:path";
import { executeDesktopJob } from "../server/indesign/desktopSession.ts";
import { FileDesktopJournal } from "../server/indesign/fileDesktopJournal.ts";
import {
  verifyDesktopInput,
  WindowsDesktopSession,
} from "../server/indesign/windowsDesktopSession.ts";

const [jobDirectory, journalDirectory, confirmation] = process.argv.slice(2);
try {
  if (
    !jobDirectory ||
    !journalDirectory ||
    confirmation !== "--operator-started"
  )
    throw new Error(
      "Expected prepared job directory, dedicated workstation journal directory, and --operator-started",
    );
  const directory = path.resolve(jobDirectory);
  const manifest = await verifyDesktopInput(directory);
  await executeDesktopJob({
    jobKey: manifest.jobKey,
    jobDirectory: directory,
    journal: new FileDesktopJournal(path.resolve(journalDirectory)),
    session: WindowsDesktopSession.operatorStarted(),
    timeoutMs: 15 * 60_000,
    operatorStarted: true,
  });
  console.log(
    JSON.stringify({
      state: "execution-finished",
      jobKey: manifest.jobKey,
      accepted: false,
      next: "Independent native package validation is required before Marketing handoff.",
    }),
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
