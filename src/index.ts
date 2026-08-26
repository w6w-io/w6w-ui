/**
 * @w6w/ui — public entry point.
 *
 * Import the stylesheet separately:
 *   import "@w6w/ui/styles.css";
 */

export { W6WUIProvider, useW6WApi } from "./provider.tsx";
export type { StepTest, TestRunSummary, W6WApi, W6WUIProviderProps } from "./provider.tsx";

export { createW6WApi, ApiError } from "./createW6WApi.ts";
export type { CreateW6WApiOptions } from "./createW6WApi.ts";

export { AddConnectionModal } from "./AddConnectionModal.tsx";
export type { AddConnectionModalProps } from "./AddConnectionModal.tsx";

export { AppPicker } from "./AppPicker.tsx";
export type { AppPickerProps } from "./AppPicker.tsx";

export { StepBuilderModal, requiredParamsFilled, isTestRequired } from "./StepBuilderModal.tsx";
export type { BuiltStep, StepBuilderModalProps } from "./StepBuilderModal.tsx";

export { ParamsForm } from "./ParamsForm.tsx";
export type { DataVar, ParamsFormProps } from "./ParamsForm.tsx";

export { PropertyEntryForm } from "./PropertyEntryForm.tsx";
export type { PropertyEntryFormProps } from "./PropertyEntryForm.tsx";

export { ActionTestForm } from "./ActionTestForm.tsx";
export type { ActionTestFormProps } from "./ActionTestForm.tsx";

export { CodeBlock } from "./CodeBlock.tsx";
export type { CodeBlockProps, CodeLanguage } from "./CodeBlock.tsx";

export { JsonEditor } from "./JsonEditor.tsx";
export type { JsonEditorProps } from "./JsonEditor.tsx";

export { CodeEditor } from "./CodeEditor.tsx";
export type { CodeEditorProps } from "./CodeEditor.tsx";

export { Modal } from "./components/Modal.tsx";
export { Copyable } from "./components/Copyable.tsx";
export type { CopyableProps } from "./components/Copyable.tsx";
export { cropText, CopyableText } from "./components/CopyableText.tsx";
export type { CopyableTextProps } from "./components/CopyableText.tsx";
export { ConfirmModal } from "./components/ConfirmModal.tsx";
export type { ConfirmModalProps } from "./components/ConfirmModal.tsx";
export { AppIcon } from "./components/AppIcon.tsx";
export { ListItem } from "./components/ListItem.tsx";
export type { ListItemProps } from "./components/ListItem.tsx";
export { HealthStatusPill } from "./components/HealthStatusPill.tsx";
export type { HealthPillState, HealthStatusPillProps } from "./components/HealthStatusPill.tsx";
export { AuthFieldsForm } from "./components/AuthFieldsForm.tsx";
export { ApiCallsPanel } from "./components/ApiCallsPanel.tsx";
export type { ApiCallsPanelProps } from "./components/ApiCallsPanel.tsx";
export { UptimeStrip } from "./components/UptimeStrip.tsx";
export type { UptimeCellState, UptimeDay, UptimeStripProps } from "./components/UptimeStrip.tsx";

export { HistoryTimeline } from "./components/HistoryTimeline.tsx";
export type {
  HistoryTimelineProps,
  HistoryWindow,
  VendorIncidentBar,
} from "./components/HistoryTimeline.tsx";

export { ExpressionInput } from "./components/ExpressionInput.tsx";
export type { ExpressionInputProps } from "./components/ExpressionInput.tsx";

export {
  ExpressionOptionsProvider,
  useExpressionOptions,
} from "./components/ExpressionOptions.tsx";
export type {
  ExpressionOptions,
  ExpressionOptionsProviderProps,
} from "./components/ExpressionOptions.tsx";

export { startOAuthPopup } from "./oauth-popup.ts";
export type { OAuthPopupResult } from "./oauth-popup.ts";

export type {
  ActionDef,
  ActionParam,
  ApiCallRecord,
  AppSummary,
  AuthDef,
  AuthField,
  ConnectionSummary,
  ExprPart,
  ExprPartKind,
  ExprValue,
  FunctionDetail,
  FunctionSummary,
  SecretValue,
  SubscriptionSummary,
  ThemeMode,
  TriggerSummary,
  WorkflowDetail,
  WorkflowSummary,
} from "./types.ts";
export { isExprValue, isSecretValue } from "./types.ts";

export { IconButton } from "./components/IconButton.tsx";
export type { IconButtonProps } from "./components/IconButton.tsx";
export { EditButton } from "./components/EditButton.tsx";
export type { EditButtonProps } from "./components/EditButton.tsx";
export { DeleteButton } from "./components/DeleteButton.tsx";
export type { DeleteButtonProps } from "./components/DeleteButton.tsx";

// Reachable from studio (TC6's rail tool reuses it — D-10) as of this project;
// verified absent from every barrel before this line (`src/index.ts` and
// `src/flow.ts` both 0 hits).
export { NodeConfigForm } from "./NodeConfigForm.tsx";
export type { NodeConfig } from "./NodeConfigForm.tsx";
