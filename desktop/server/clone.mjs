import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { validateRepositoryName } from "./validation.mjs";

export function validateCloneMethod(value) {
  if (!["https", "ssh", "cli"].includes(value))
    throw new Error(
      "Choose HTTPS, SSH, or GitHub CLI to clone this repository.",
    );
  return value;
}

export function cloneCommand(value, selection, destination, env = process.env) {
  const repo = validateRepositoryName(value);
  const method = validateCloneMethod(selection);
  if (
    typeof destination !== "string" ||
    !path.isAbsolute(destination) ||
    destination.includes("\0")
  )
    throw new Error("Choose a destination folder first.");
  return {
    executable: method === "cli" ? "gh" : "git",
    args:
      method === "cli"
        ? ["repo", "clone", repo, destination]
        : [
            "clone",
            "--",
            method === "ssh"
              ? `git@github.com:${repo}.git`
              : `https://github.com/${repo}.git`,
            destination,
          ],
    options: {
      shell: false,
      timeout: 300_000,
      maxBuffer: 4 * 1024 * 1024,
      // Keep existing Git credentials, SSH configuration/agent, and gh protocol.
      // A GUI clone cannot answer terminal prompts. Never bypass host checking.
      env: {
        ...env,
        GIT_TERMINAL_PROMPT: "0",
        SSH_ASKPASS_REQUIRE: "never",
        ...(method === "cli"
          ? { GH_HOST: "github.com", GH_PROMPT_DISABLED: "1" }
          : {}),
      },
    },
  };
}

export function cloneFailureMessage(error, method) {
  if (error?.code === "ENOENT")
    return method === "cli"
      ? "GitHub CLI is not installed. Install gh and sign in with gh auth login, then try again."
      : "Git is not installed. Install Git and try again.";
  // Examine stderr only to choose fixed guidance; never expose credentials or
  // arbitrary subprocess output to the renderer.
  const details = typeof error?.stderr === "string" ? error.stderr : "";
  let message;
  if (
    /host key verification failed|remote host identification has changed/i.test(
      details,
    )
  )
    message =
      "SSH could not verify GitHub's host key. Verify the host in your terminal before trying again.";
  else if (
    /permission denied[^\n]*publickey|could not open a connection to your authentication agent/i.test(
      details,
    )
  )
    message =
      "SSH authentication failed. Check that your GitHub SSH key is available and unlocked in your SSH agent.";
  else if (method === "ssh")
    message =
      "SSH clone failed. Check your GitHub SSH key, repository access, and connection. Unlock your key in your SSH agent if needed.";
  else if (method === "cli")
    message =
      "GitHub CLI clone failed. Check gh auth status, Git installation, and repository access. If gh uses SSH, check your SSH key and agent too.";
  else
    message =
      "HTTPS clone failed. Check your Git credentials, repository access, and connection.";
  return `${message} A partial folder may remain in the location you selected.`;
}

export function createCloneHandler({
  execute,
  selectFolder,
  rememberFolder,
  withPicker,
}) {
  return async (value, selection) => {
    // Validate both IPC inputs before opening a native dialog or running a tool.
    const repo = validateRepositoryName(value);
    const method = validateCloneMethod(selection);
    return withPicker(async () => {
      const parent = await selectFolder(`Choose where to clone ${repo}`);
      if (!parent) return { canceled: true };
      const destination = path.join(await realpath(parent), repo.split("/")[1]);
      try {
        await lstat(destination);
        throw new Error(
          "That folder already exists. Choose another parent folder.",
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const command = cloneCommand(repo, method, destination);
      try {
        await execute(command.executable, command.args, command.options);
      } catch (error) {
        throw new Error(cloneFailureMessage(error, method));
      }
      return { canceled: false, path: await rememberFolder(destination) };
    });
  };
}
