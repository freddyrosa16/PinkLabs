import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeftIcon,
  GlobeIcon,
  LockIcon,
  MarkGithubIcon,
  RepoIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { api } from "./api";
import type {
  CreateRepositoryInput,
  RepositoryCreationOptions,
  RepoSummary,
} from "./types";
import "./repository-creator.css";

const initialDraft = (): CreateRepositoryInput => ({
  owner: "",
  name: "",
  description: "",
  visibility: "private",
  initializeReadme: true,
  gitignoreTemplate: "",
  licenseTemplate: "",
});

export function RepositoryCreator({
  active,
  close,
  openRepository,
  notify,
}: {
  active: boolean;
  close: () => void;
  openRepository: (fullName: string) => void;
  notify: (message: string) => void;
}) {
  const [options, setOptions] = useState<RepositoryCreationOptions | null>(
    null,
  );
  const [draft, setDraft] = useState(initialDraft);
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"creating" | "checking" | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [checkedMissing, setCheckedMissing] = useState(false);
  const [created, setCreated] = useState<RepoSummary | null>(null);
  const pending = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api
      .repositoryCreationOptions()
      .then((value) => {
        if (!alive) return;
        setOptions(value);
        setDraft((current) => ({
          ...current,
          owner: value.owners.some((owner) => owner.login === current.owner)
            ? current.owner
            : value.account,
          gitignoreTemplate: value.gitignoreTemplates.includes(
            current.gitignoreTemplate,
          )
            ? current.gitignoreTemplate
            : "",
          licenseTemplate: value.licenses.some(
            (license) => license.key === current.licenseTemplate,
          )
            ? current.licenseTemplate
            : "",
        }));
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loadVersion]);

  useEffect(() => {
    if (active) headingRef.current?.focus({ preventScroll: true });
  }, [active]);

  function change<K extends keyof CreateRepositoryInput>(
    key: K,
    value: CreateRepositoryInput[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError("");
    setCheckedMissing(false);
  }

  function complete(repository: RepoSummary, recovered = false) {
    setCreated(repository);
    setUncertain(false);
    setError("");
    notify(
      recovered
        ? `Found ${repository.fullName} on GitHub.`
        : `Created ${repository.fullName} on GitHub.`,
    );
    if (activeRef.current) openRepository(repository.fullName);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || uncertain || !options || created) return;
    if ([".", ".."].includes(draft.name.trim())) {
      setError("Choose a repository name other than . or .. .");
      return;
    }
    pending.current = true;
    setBusy("creating");
    setError("");
    setCheckedMissing(false);
    try {
      const result = await api.createRepository({
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim(),
      });
      if (result.status === "created") complete(result.repository);
      else {
        setUncertain(result.status === "uncertain");
        setError(result.message);
      }
    } catch (e) {
      // A lost transport response may follow a successful write. Check before
      // offering any retry, even if the failure appears to be validation-related.
      setUncertain(true);
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  async function check() {
    if (pending.current) return;
    pending.current = true;
    setBusy("checking");
    setError("");
    try {
      const result = await api.checkCreatedRepository({
        owner: draft.owner,
        name: draft.name.trim(),
      });
      if (result && result.private !== (draft.visibility === "private")) {
        setError(
          `The repository exists, but its visibility is ${result.private ? "private" : "public"} instead of ${draft.visibility}. Review its visibility on GitHub before continuing.`,
        );
      } else if (result) complete(result, true);
      else {
        setUncertain(false);
        setCheckedMissing(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  const locked = Boolean(busy) || uncertain || Boolean(created);
  return (
    <section
      className="repository-creator"
      hidden={!active}
      aria-label="Create a repository"
    >
      <header className="topbar">
        <button
          className="icon-button"
          aria-label="Back to repository"
          onClick={close}
          disabled={Boolean(busy)}
        >
          <ArrowLeftIcon />
        </button>
        <div className="breadcrumb">
          <MarkGithubIcon size={17} />
          <span>GitHub</span>
          <span className="slash">›</span>
          <b>New repository</b>
        </div>
        <div className="topbar-right">
          <button
            className="button"
            type="button"
            disabled={loading || locked}
            onClick={() => setLoadVersion((v) => v + 1)}
          >
            <SyncIcon size={14} /> Refresh options
          </button>
        </div>
      </header>
      <div className="repository-creator-scroll">
        <form
          className="repository-creator-form"
          onSubmit={submit}
          aria-busy={Boolean(busy)}
        >
          <div className="repository-creator-intro">
            <RepoIcon size={25} />
            <h1 ref={headingRef} tabIndex={-1}>
              Create a repository
            </h1>
            <p>
              A home for your next project. Set it up here, then start building.
            </p>
          </div>
          {loading ? (
            <p className="repository-creator-notice" role="status">
              <SyncIcon className="spin" /> Loading your GitHub account and
              templates…
            </p>
          ) : !options ? (
            <div className="repository-creator-notice">
              <p role="alert">{error}</p>
              <button
                className="button"
                type="button"
                onClick={() => setLoadVersion((v) => v + 1)}
              >
                Try again
              </button>
            </div>
          ) : created ? (
            <div
              className="repository-creator-card repository-created"
              role="status"
            >
              <h2>{created.fullName}</h2>
              <p>Your repository is ready on GitHub.</p>
              <button
                type="button"
                className="button primary"
                onClick={() => openRepository(created.fullName)}
              >
                Open repository
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setCreated(null);
                  setDraft({ ...initialDraft(), owner: options.account });
                  setCheckedMissing(false);
                }}
              >
                Create another
              </button>
            </div>
          ) : (
            <>
              <fieldset disabled={locked} className="repository-fields">
                <legend className="sr-only">Repository settings</legend>
                <div className="repository-creator-card">
                  <h2>General</h2>
                  <div className="repository-name-fields">
                    <label>
                      Owner
                      <select
                        value={draft.owner}
                        onChange={(e) => change("owner", e.target.value)}
                        required
                        aria-label="Repository owner"
                      >
                        {options.owners.map((owner) => (
                          <option key={owner.login} value={owner.login}>
                            {owner.login}
                            {owner.type === "organization"
                              ? " (organization)"
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="repository-name-slash" aria-hidden="true">
                      /
                    </span>
                    <label>
                      Repository name
                      <input
                        value={draft.name}
                        onChange={(e) => change("name", e.target.value)}
                        required
                        maxLength={100}
                        pattern="[A-Za-z0-9_.\-]+"
                        title="Use letters, numbers, periods, underscores, and hyphens."
                        placeholder="my-next-project"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                  </div>
                  <label className="repository-description">
                    Description <span>optional</span>
                    <input
                      value={draft.description}
                      onChange={(e) => change("description", e.target.value)}
                      maxLength={350}
                      placeholder="What are you building?"
                    />
                  </label>
                </div>
                <fieldset className="repository-visibility">
                  <legend>Visibility</legend>
                  <div className="repository-visibility-options">
                    {(["private", "public"] as const).map((visibility) => (
                      <label
                        key={visibility}
                        className={
                          draft.visibility === visibility ? "selected" : ""
                        }
                      >
                        <input
                          type="radio"
                          name="repository-visibility"
                          value={visibility}
                          checked={draft.visibility === visibility}
                          onChange={() => change("visibility", visibility)}
                        />
                        {visibility === "private" ? (
                          <LockIcon size={19} />
                        ) : (
                          <GlobeIcon size={19} />
                        )}
                        <span>
                          <strong>
                            {visibility === "private" ? "Private" : "Public"}
                          </strong>
                          <small>
                            {visibility === "private"
                              ? "You choose who has access."
                              : "Anyone can see this repository."}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="repository-creator-card repository-initialize">
                  <h2>Start with the essentials</h2>
                  <label className="repository-readme">
                    <span>
                      <strong>Add a README</strong>
                      <small>Introduce your project and how to use it.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.initializeReadme}
                      onChange={(e) =>
                        change("initializeReadme", e.target.checked)
                      }
                    />
                  </label>
                  <label className="repository-template">
                    <span>
                      <strong>.gitignore</strong>
                      <small>Keep generated and local files out of Git.</small>
                    </span>
                    <select
                      aria-label="Gitignore template"
                      value={draft.gitignoreTemplate}
                      onChange={(e) =>
                        change("gitignoreTemplate", e.target.value)
                      }
                    >
                      <option value="">None</option>
                      {options.gitignoreTemplates.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="repository-template">
                    <span>
                      <strong>License</strong>
                      <small>Set how others may use your code.</small>
                    </span>
                    <select
                      aria-label="License template"
                      value={draft.licenseTemplate}
                      onChange={(e) =>
                        change("licenseTemplate", e.target.value)
                      }
                    >
                      <option value="">None</option>
                      {options.licenses.map((license) => (
                        <option key={license.key} value={license.key}>
                          {license.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </fieldset>
              {options.warnings.map((warning) => (
                <p className="repository-creator-notice" key={warning}>
                  {warning}
                </p>
              ))}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {uncertain && (
                <div className="repository-creator-notice">
                  <p>
                    The request may have reached GitHub. Check for{" "}
                    <strong>
                      {draft.owner}/{draft.name.trim()}
                    </strong>{" "}
                    before trying again.
                  </p>
                  <button
                    type="button"
                    className="button"
                    disabled={Boolean(busy)}
                    onClick={() => void check()}
                  >
                    {busy === "checking" ? "Checking…" : "Check on GitHub"}
                  </button>
                </div>
              )}
              {checkedMissing && (
                <p className="repository-creator-notice" role="status">
                  No repository was found at that name for this account. You can
                  adjust the settings and try creating it again.
                </p>
              )}
              <div className="repository-creator-footer">
                <p>
                  Creates a <strong>{draft.visibility}</strong> repository on
                  GitHub.
                  <br />
                  <span>You can clone it to your computer afterward.</span>
                </p>
                <button
                  className="button primary"
                  disabled={locked || !draft.name.trim() || !draft.owner}
                >
                  {busy === "creating"
                    ? "Creating repository…"
                    : "Create repository"}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </section>
  );
}
