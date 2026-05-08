import { type ApprovalRequestId, type ProviderApprovalDecision } from "@fenrir/contracts";
import { memo } from "react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  isResponding: boolean;
  /**
   * When true, the "Approve once" / "Decline" / "Cancel" buttons advertise their
   * keyboard shortcut (Y / N / Esc) via tooltips. Only set on command approvals
   * since that is where ChatComposer registers the global key handler.
   */
  showShortcuts?: boolean;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<void>;
}

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  showShortcuts,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const cancelButton = (
    <Button
      size="sm"
      variant="ghost"
      disabled={isResponding}
      onClick={() => void onRespondToApproval(requestId, "cancel")}
    >
      Cancel turn
    </Button>
  );
  const declineButton = (
    <Button
      size="sm"
      variant="destructive-outline"
      disabled={isResponding}
      onClick={() => void onRespondToApproval(requestId, "decline")}
    >
      Decline
    </Button>
  );
  const approveButton = (
    <Button
      size="sm"
      variant="default"
      disabled={isResponding}
      onClick={() => void onRespondToApproval(requestId, "accept")}
    >
      Approve once
    </Button>
  );

  return (
    <>
      {showShortcuts ? (
        <Tooltip>
          <TooltipTrigger render={cancelButton} />
          <TooltipPopup side="top">Esc</TooltipPopup>
        </Tooltip>
      ) : (
        cancelButton
      )}
      {showShortcuts ? (
        <Tooltip>
          <TooltipTrigger render={declineButton} />
          <TooltipPopup side="top">N</TooltipPopup>
        </Tooltip>
      ) : (
        declineButton
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={isResponding}
        onClick={() => void onRespondToApproval(requestId, "acceptForSession")}
      >
        Always allow this session
      </Button>
      {showShortcuts ? (
        <Tooltip>
          <TooltipTrigger render={approveButton} />
          <TooltipPopup side="top">Y</TooltipPopup>
        </Tooltip>
      ) : (
        approveButton
      )}
    </>
  );
});
