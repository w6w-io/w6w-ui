import { useEffect, useState } from "react";
import { AppPicker } from "./AppPicker.tsx";
import { AppIcon } from "./components/AppIcon.tsx";
import { AuthFieldsForm } from "./components/AuthFieldsForm.tsx";
import { Modal } from "./components/Modal.tsx";
import { startOAuthPopup } from "./oauth-popup.ts";
import { useW6WApi } from "./provider.tsx";
import type { AppSummary, AuthDef, AuthField, ThemeMode } from "./types.ts";

export interface AddConnectionModalProps {
  onClose: () => void;
  /** Fired after a successful create (both API-key and OAuth paths). */
  onCreated: (result: { connectionId: string }) => void;
  /** Optional theme hint passed through to `AppIcon` (light/dark variant). */
  theme?: ThemeMode;
  /**
   * Pre-select an app and skip the picker — used when the modal is opened for a
   * specific app (e.g. from the step builder). Omit to let the user pick.
   */
  initialAppId?: string;
}

/**
 * Add-connection modal. Same shape as the step builder's "add a step" modal —
 * the shared {@link AppPicker} (searchable icon grid) for step one, then the
 * chosen app's connection fields for step two — minus the tabs. Pick an app →
 * pick an auth method → fill the fields (or run OAuth) → submit. The
 * `AuthDef.fields` array drives the form, so no app-specific knowledge is baked
 * in. Data + IO come from `useW6WApi()`.
 */
export function AddConnectionModal(props: AddConnectionModalProps) {
  const api = useW6WApi();
  const [selectedApp, setSelectedApp] = useState<AppSummary | null>(null);
  const [resolvingInitial, setResolvingInitial] = useState<boolean>(Boolean(props.initialAppId));

  // Opened for a specific app: resolve it to an AppSummary (for the header) and
  // go straight to the connection fields, skipping the picker.
  useEffect(() => {
    if (!props.initialAppId) return;
    let canceled = false;
    api
      .listApps()
      .then((apps) => {
        if (!canceled) setSelectedApp(apps.find((a) => a.id === props.initialAppId) ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!canceled) setResolvingInitial(false);
      });
    return () => {
      canceled = true;
    };
  }, [api, props.initialAppId]);

  // Step two: the chosen app's connection fields.
  if (selectedApp) {
    return (
      <Modal
        title={selectedApp.displayName}
        subtitle={
          <>
            <code>{selectedApp.id}</code>
            {selectedApp.version && ` · v${selectedApp.version}`}
          </>
        }
        onClose={props.onClose}
        size="xl"
        titleIcon={
          <AppIcon
            src={selectedApp.iconSvg}
            srcDark={selectedApp.iconSvgDark}
            brandColor={selectedApp.brandColor}
            name={selectedApp.displayName}
            theme={props.theme}
            size={22}
          />
        }
        headerRight={
          props.initialAppId ? undefined : (
            <button
              type="button"
              className="w6w-btn w6w-btn-ghost"
              onClick={() => setSelectedApp(null)}
            >
              ← Apps
            </button>
          )
        }
      >
        <div className="w6w-stepbuilder-content">
          <ConnectionConfig app={selectedApp} onCreated={props.onCreated} onClose={props.onClose} />
        </div>
      </Modal>
    );
  }

  // Resolving an initialAppId — don't flash the picker.
  if (resolvingInitial) {
    return (
      <Modal title="Add connection" onClose={props.onClose} size="xl">
        <div className="w6w-stepbuilder-content">
          <p className="w6w-muted w6w-small">Loading…</p>
        </div>
      </Modal>
    );
  }

  // Step one: the shared searchable app picker (icons + search).
  return (
    <Modal title="Add connection" onClose={props.onClose} size="xl">
      <div className="w6w-stepbuilder-content">
        <AppPicker
          onSelectApp={setSelectedApp}
          theme={props.theme}
          searchPlaceholder="Search apps to connect…"
          categoryFilter
        />
      </div>
    </Modal>
  );
}

/**
 * The chosen app's connection form: pick an auth method (when >1), name the
 * connection, fill the credential fields (or run OAuth), and submit.
 */
function ConnectionConfig({
  app,
  onCreated,
  onClose,
}: {
  app: AppSummary;
  onCreated: (result: { connectionId: string }) => void;
  onClose: () => void;
}) {
  const api = useW6WApi();
  const [auths, setAuths] = useState<AuthDef[] | null>(null);
  const [authKey, setAuthKey] = useState<string>("");
  const [displayName, setDisplayName] = useState("");
  const [credential, setCredential] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let canceled = false;
    setAuths(null);
    api
      .getAppAuth(app.id)
      // Hide methods the server flagged unavailable (e.g. oauth2 with no host creds).
      .then((a) => !canceled && setAuths(a.filter((x) => x.available !== false)))
      .catch((e) => !canceled && setError((e as Error).message));
    return () => {
      canceled = true;
    };
  }, [api, app.id]);

  const available = auths ?? [];
  const auth: AuthDef | undefined = available.find((a) => a.key === authKey) ?? available[0];
  const fields: AuthField[] = auth?.fields ?? [];
  const isOAuth = auth?.type === "oauth2";
  const requiredMissing =
    !isOAuth &&
    fields.some((f) => f.required && (credential[f.key] === undefined || credential[f.key] === ""));

  async function submit() {
    if (!auth) return;
    setError(null);
    setPending(true);
    try {
      if (isOAuth) {
        const { authorizationUrl } = await api.startAppOAuthFlow(app.id, auth.key, {
          displayName: displayName || undefined,
        });
        const { connectionId } = await startOAuthPopup(authorizationUrl);
        onCreated({ connectionId });
      } else {
        const conn = await api.createConnection(app.id, {
          authKey: auth.key,
          credential,
          displayName: displayName || undefined,
        });
        onCreated({ connectionId: conn.id });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w6w-stack">
      {auths === null && <p className="w6w-muted w6w-small">Loading auth methods…</p>}

      {auths !== null && available.length === 0 && (
        <p className="w6w-muted w6w-small">
          This app has no available auth methods. If it uses OAuth, its client credentials may not
          be configured on the server yet.
        </p>
      )}

      {available.length > 1 && (
        <label className="w6w-field">
          <span>Auth method</span>
          <select
            value={auth?.key ?? ""}
            onChange={(e) => {
              setAuthKey(e.target.value);
              setCredential({});
              setError(null);
            }}
          >
            {available.map((a) => (
              <option key={a.key} value={a.key}>
                {a.displayName ?? a.key} ({a.type})
              </option>
            ))}
          </select>
        </label>
      )}

      {auth && (
        <>
          <label className="w6w-field">
            <span>Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Production API key"
              // A plain text field above a credential field gets treated as the
              // "username" of a login form and prefilled — opt it out.
              name="w6w-connection-label"
              autoComplete="off"
              data-1p-ignore="true"
              data-lpignore="true"
              data-bwignore="true"
              data-form-type="other"
            />
          </label>
          {auth.description && <p className="w6w-muted w6w-small">{auth.description}</p>}
          {isOAuth ? (
            <p className="w6w-muted w6w-small">
              You'll be redirected to <strong>{auth.displayName ?? auth.key}</strong> to authorize
              this connection.
            </p>
          ) : (
            <AuthFieldsForm fields={fields} values={credential} onChange={setCredential} />
          )}
        </>
      )}

      {error && <div className="w6w-result w6w-error">{error}</div>}

      <div className="w6w-modal-actions">
        <button type="button" className="w6w-btn w6w-btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="w6w-btn"
          disabled={!auth || (!isOAuth && requiredMissing) || pending}
          onClick={submit}
        >
          {pending
            ? isOAuth
              ? "Waiting for authorization…"
              : "Saving…"
            : isOAuth
              ? `Sign in with ${auth?.displayName ?? auth?.key ?? "provider"}`
              : "Save connection"}
        </button>
      </div>
    </div>
  );
}
