import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Collapse,
  Descriptions,
  Drawer,
  Form,
  Image,
  Input,
  message,
  Select,
  Space,
  Tag,
} from "antd";
import { isAdminUser } from "../../utils/access";
import { useAuth } from "../../contexts/AuthContext";
import {
  nativeAfterSales,
  type NativeCaseDetail,
  type NativeOptions,
} from "../../services/native-after-sales.service";
import { registrationTokenMatchesActor } from "./pending-registration";
import {
  clearPendingConfirmation,
  confirmationLabels,
  confirmationStatuses,
  notificationStatuses,
  notificationAction,
  notificationTypes,
  pendingConfirmationKey,
  proposalBlocker,
  readPendingConfirmation,
  savePendingConfirmation,
  type ConfirmationPurpose,
  type CustomerConfirmation,
  type CustomerNotification,
  type NativeCommunication,
  type PendingConfirmation,
  type PhysicalConfirmationBinding,
  type RepairProposal,
} from "./native-communication-model";
import "./NativeCaseCommunication.css";
import NativeLegacyBrandReview from './NativeLegacyBrandReview';
import { operationRequestIntent } from './operation-request-intent';
type CommandTransport = {
  command: (
    entityId: string,
    id: string,
    suffix: "communications" | "repair-proposals/adopt" | "factory-actions",
    payload: Record<string, unknown>,
    auth: { token: string; expectedActorId: string; signal: AbortSignal },
  ) => Promise<Record<string, unknown>>;
  photo?: (
    entityId: string,
    id: string,
    confirmationId: string,
    index: number,
    signal: AbortSignal,
  ) => Promise<{ name: string; dataUrl: string }>;
};
type Props = {
  entityId: string;
  detail: NativeCaseDetail;
  options?: NativeOptions & {
    factoryAssignees?: { value: string; label: string }[];
  };
  onReload: () => void;
  onPendingChange: (pending: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
};
const factoryStatuses: Record<string, string> = {
  ASSIGNED: "待接手",
  ACCEPTED: "已接手，待回覆",
  REPLIED: "已回覆，待核定",
  CLOSED: "已結案",
};
const planLabels: Record<string, string> = {
  REPAIR: "維修",
  REPLACE: "更換產品",
  FACTORY: "送回工廠",
  RETURN: "寄回原件",
};
const errorText = (error: unknown) => {
  const value = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof value === "string" && value.length < 500
    ? value
    : error instanceof Error && error.message.length < 200
      ? error.message
      : "作業結果待確認，請更新案件";
};
export default function NativeCaseCommunication({
  entityId,
  detail,
  options,
  onReload,
  onPendingChange,
  onDirtyChange,
}: Props) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const selectActivity = (value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("caseActivity", value);
        return next;
      },
      { replace: true },
    );
  const scope = { actorId: user?.id || "", entityId, caseId: detail.id };
  const scopeKey = JSON.stringify(scope);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const alive = useRef(true);
  const abort = useRef<AbortController | undefined>(undefined);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [brandPending, setBrandPending] = useState(false);
  const pendingStates = useRef({ communication: false, brand: false });
  const markPending = (value: boolean) => { pendingStates.current.communication = value; onPendingChange(value || pendingStates.current.brand); };
  const markBrandPending = (value: boolean) => { pendingStates.current.brand = value; setBrandPending(value); onPendingChange(value || pendingStates.current.communication); };
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [purpose, setPurpose] = useState<ConfirmationPurpose>("PROFILE");
  const [bindingId, setBindingId] = useState<string>();
  const [link, setLink] = useState<{ url: string; purpose: string }>();
  const [review, setReview] = useState<CustomerConfirmation>();
  const [reviewNote, setReviewNote] = useState("");
  const [notification, setNotification] = useState<CustomerNotification>();
  const [compose, setCompose] = useState(false);
  const [factoryEdit, setFactoryEdit] = useState<
    "ASSIGN" | "REPLY" | "CLOSE"
  >();
  const [photo, setPhoto] = useState<{ name: string; dataUrl: string }>();
  const [notificationForm] = Form.useForm();
  const [factoryForm] = Form.useForm();
  const communication =
    detail.communication as unknown as NativeCommunication | null;
  const canLine =
    detail.canCommunicate === true &&
    ["MOZTECH", "BONSON"].includes(detail.brandCode || "") &&
    !!detail.updatedAt;
  const canFactory =
    detail.canCommunicate === true &&
    detail.type === "CUSTOMER_ISSUE" &&
    !!detail.brandCode;
  const proposals = (detail.repairProposals ||
    []) as unknown as RepairProposal[];
  const proposalError = proposalBlocker(proposals, detail.proposalOverflow);
  const proposed = proposals.some((row) => row.status === "PROPOSED");
  const bindings: PhysicalConfirmationBinding[] =
    purpose === "PRODUCT"
      ? communication?.productBindings || []
      : proposals
          .map((row) => ({
            itemId: row.itemId,
            label: row.proposal?.original.productName,
            planVersion: row.planVersion,
            planHash: row.proposal?.planHash,
            proposalHash: row.proposal?.proposalHash,
          }))
          .filter((row) => !!row.planHash);
  const allConfirmations = communication?.confirmations || [];
  const visibleLink =
    link ||
    allConfirmations.find(
      (row) => row.status === "PENDING" && row.url && row.purpose === purpose,
    );
  const notifications = communication?.notifications || [];
  const factory = communication?.factory;
  const canFactoryOwner =
    canFactory &&
    (!factory ||
      isAdminUser(user) ||
      factory.assigneeId === communication?.sourceActorId);
  useEffect(() => {
    alive.current = true;
    setError("");
    setUnknown(false);
    setBusy(false);
    busyRef.current = false;
    setLink(undefined);
    setCompose(false);
    setReview(undefined);
    setNotification(undefined);
    setFactoryEdit(undefined);
    try {
      const saved = readPendingConfirmation(localStorage, scope);
      setPending(saved);
      if (saved) {
        setError("顧客確認連結建立結果待確認，請重試確認");
        setPurpose(saved.request.purpose);
        setBindingId(saved.request.binding?.itemId);
        markPending(true);
      }
    } catch (error) {
      setError(errorText(error));
      setUnknown(true);
      markPending(true);
    }
    return () => {
      alive.current = false;
      abort.current?.abort();
      pendingStates.current = { communication: false, brand: false };
      onPendingChange(false);
      onDirtyChange(false);
    };
  }, [scopeKey]);
  useEffect(() => {
    if (!pending) return;
    const receipt = allConfirmations.find(
      (row) => row.id === pending.request.requestId,
    );
    if (!receipt) return;
    try {
      clearPendingConfirmation(localStorage, scope, pending.request.requestId);
      setPending(null);
      setError("");
      setUnknown(false);
      markPending(false);
      if (receipt.url) setLink({ url: receipt.url, purpose: receipt.purpose });
    } catch (error) {
      setError(errorText(error));
    }
  }, [detail.updatedAt, communication, pending]);
  useEffect(() => {
    if (unknown && !pending) {
      setUnknown(false);
      markPending(false);
    }
  }, [communication]);
  const isCurrent = (key: string, token: string) =>
    alive.current &&
    scopeRef.current === key &&
    localStorage.getItem("access_token") === token &&
    registrationTokenMatchesActor(token, scope.actorId);
  const authFor = () => {
    const token = localStorage.getItem("access_token") || "";
    if (
      !user?.id ||
      !entityId ||
      !registrationTokenMatchesActor(token, user.id)
    )
      throw new Error("登入狀態已變更，請重新登入");
    const controller = new AbortController();
    abort.current = controller;
    return { token, expectedActorId: user.id, signal: controller.signal };
  };
  const run = async (
    suffix: "communications" | "repair-proposals/adopt" | "factory-actions",
    payload: Record<string, unknown>,
  ) => {
    if (busyRef.current || pending || unknown || brandPending) return;
    const key = scopeKey;
    let token = "";
    try {
      if (suffix === "factory-actions" ? !canFactory : !canLine)
        throw new Error("此案件尚無此操作權限");
      const auth = authFor();
      token = auth.token;
      busyRef.current = true;
      setBusy(true);
      setError("");
      markPending(true);
      const result = await (
        nativeAfterSales as unknown as CommandTransport
      ).command(entityId, detail.id, suffix, payload, auth);
      if (!isCurrent(key, token)) return;
      markPending(false);
      onDirtyChange(false);
      setCompose(false);
      setFactoryEdit(undefined);
      setReview(undefined);
      setNotification(undefined);
      setUnknown(false);
      selectActivity(
        suffix === "factory-actions"
          ? "factory"
          : suffix === "repair-proposals/adopt"
            ? "proposals"
            : String(payload.operation).includes("NOTIFICATION")
              ? "notifications"
              : "confirmations",
      );
      onReload();
      if (typeof result.status === "string")
        message.success(
          notificationStatuses[result.status] ||
            confirmationStatuses[result.status] ||
            factoryStatuses[result.status] ||
            "已儲存",
        );
      else message.success("已儲存");
      return result;
    } catch (error) {
      if (alive.current && scopeRef.current === key) {
        setError(errorText(error));
        if (token) {
          setUnknown(true);
          markPending(true);
        } else markPending(false);
      }
    } finally {
      if (alive.current && scopeRef.current === key) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const createConfirmation = async () => {
    if (busyRef.current || !canLine || brandPending) return;
    const key = scopeKey;
    let saved: PendingConfirmation | null = pending;
    let persisted = !!pending;
    let token = "";
    busyRef.current = true;
    setBusy(true);
    setError("");
    markPending(true);
    try {
      const auth = authFor();
      token = auth.token;
      if (!navigator.locks) throw new Error("目前瀏覽器無法安全建立確認連結");
      await navigator.locks.request(
        pendingConfirmationKey(scope),
        { mode: "exclusive", signal: auth.signal },
        async () => {
          if (!isCurrent(key, token))
            throw new Error("登入狀態已變更，連結未送出");
          saved = readPendingConfirmation(localStorage, scope);
          if (!saved) {
            const chosen =
              bindings.find((row) => row.itemId === bindingId) || bindings[0];
            if (["PRODUCT", "DISPOSITION"].includes(purpose) && !chosen)
              throw new Error("尚無可確認的實收品項或處理方案");
            if (
              purpose === "QUOTE" &&
              !detail.currentStepFields.some(
                (field) => field.key === "quoteAmount" && field.value !== null,
              )
            )
              throw new Error("請先完成正式報價");
            saved = {
              ...scope,
              schema: "corely.doa.pending-confirmation.v1",
              request: {
                operation: "CREATE_CONFIRMATION",
                requestId: crypto.randomUUID(),
                purpose,
                expectedUpdatedAt: detail.updatedAt!,
                ...(["PRODUCT", "DISPOSITION"].includes(purpose)
                  ? {
                      binding: {
                        itemId: chosen!.itemId,
                        planVersion: chosen!.planVersion,
                        planHash: chosen!.planHash,
                        ...(purpose === "DISPOSITION"
                          ? { proposalHash: chosen!.proposalHash }
                          : {}),
                      },
                    }
                  : {}),
              },
            };
            savePendingConfirmation(localStorage, saved);
          }
          persisted = true;
          setPending(saved);
          operationRequestIntent('after_sales.confirmation.request', saved.request.requestId, detail.id);
          const result = await (
            nativeAfterSales as unknown as CommandTransport
          ).command(
            entityId,
            detail.id,
            "communications",
            saved.request as unknown as Record<string, unknown>,
            auth,
          );
          if (!isCurrent(key, token)) return;
          if (result.id !== saved.request.requestId)
            throw new Error("確認連結結果待核對，請使用相同請求重試");
          clearPendingConfirmation(
            localStorage,
            scope,
            saved.request.requestId,
          );
          setPending(null);
          setUnknown(false);
          markPending(false);
          if (typeof result.url === "string" && result.status === "PENDING")
            setLink({ url: result.url, purpose: saved.request.purpose });
          message.success(
            result.status === "PENDING"
              ? "顧客確認連結已建立"
              : "顧客確認結果已核對",
          );
          selectActivity("confirmations");
          onReload();
        },
      );
    } catch (error) {
      if (alive.current && scopeRef.current === key) {
        setError(errorText(error));
        markPending(persisted);
        setUnknown(persisted);
      }
    } finally {
      if (alive.current && scopeRef.current === key) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      message.success("連結已複製");
    } catch {
      message.error("複製失敗，請手動選取連結");
    }
  };
  const reviewConfirmation = (row: CustomerConfirmation) => {
    setReview(row);
    setReviewNote("");
  };
  const submitReview = async (approve: boolean) => {
    if (!review) return;
    if (!reviewNote.trim()) {
      message.error("請填寫審核備註");
      return;
    }
    await run("communications", {
      operation: "REVIEW_CONFIRMATION",
      confirmationId: review.id,
      approve,
      note: reviewNote.trim(),
    });
  };
  const openPhoto = async (row: CustomerConfirmation, index: number) => {
    try {
      const transport = nativeAfterSales as unknown as CommandTransport;
      if (!transport.photo) throw new Error("照片預覽尚未開通");
      const controller = new AbortController();
      const key = scopeKey;
      const token = localStorage.getItem("access_token") || "";
      if (!registrationTokenMatchesActor(token, scope.actorId))
        throw new Error("登入狀態已變更，請重新登入");
      const result = await transport.photo(
        entityId,
        detail.id,
        row.id,
        index,
        controller.signal,
      );
      if (isCurrent(key, token)) setPhoto(result);
    } catch (error) {
      message.error(errorText(error));
    }
  };
  const composeNotification = () => {
    notificationForm.resetFields();
    notificationForm.setFieldsValue({
      type: detail.type === "CUSTOMER_ISSUE" ? "ISSUE_REPLY" : "CASE_CREATED",
      title: detail.caseNumber,
      text: "",
    });
    setCompose(true);
  };
  const submitNotification = async () => {
    try {
      const values = await notificationForm.validateFields();
      await run("communications", {
        operation: "REQUEST_NOTIFICATION",
        eventId: "csr-" + crypto.randomUUID(),
        type: values.type,
        payload: { title: values.title.trim(), text: values.text.trim() },
      });
    } catch {
      window.dispatchEvent(
        new CustomEvent("operation-interaction", {
          detail: {
            actionId: "after_sales.notification.create",
            outcome: "VALIDATION_BLOCKED",
          },
        }),
      );
    }
  };
  const editFactory = (action: "ASSIGN" | "REPLY" | "CLOSE") => {
    factoryForm.resetFields();
    factoryForm.setFieldsValue({
      factoryName: factory?.factoryName,
      assigneeId: factory?.assigneeId,
      issueSummary: factory?.issueSummary,
    });
    setFactoryEdit(action);
  };
  const submitFactory = async () => {
    try {
      const values = await factoryForm.validateFields();
      await run("factory-actions", {
        action: factoryEdit,
        ...(factory ? { expectedRevision: factory.revision } : {}),
        ...values,
      });
    } catch {
      window.dispatchEvent(
        new CustomEvent("operation-interaction", {
          detail: {
            actionId: "after_sales.factory.submit",
            outcome: "VALIDATION_BLOCKED",
          },
        }),
      );
    }
  };
  const disabled = busy || !!pending || unknown || brandPending;
  const activeNotificationAction = notification ? notificationAction(notification, communication?.aiCustomerService?.transport) : null;
  return (
    <section data-operation-record-id={detail.id} className="native-case-communication" aria-label="顧客確認與通知">
      <NativeLegacyBrandReview entityId={entityId} detail={detail} onReload={onReload} onPendingChange={markBrandPending} onDirtyChange={onDirtyChange} />
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            pending ? (
              <Button
                data-operation-action="after_sales.confirmation.retry"
                loading={busy}
                onClick={() => void createConfirmation()}
              >
                重試確認連結
              </Button>
            ) : unknown ? (
              <Button
                data-operation-action="after_sales.communication.reconcile"
                disabled={busy}
                onClick={onReload}
              >
                更新案件
              </Button>
            ) : undefined
          }
        />
      )}
      {canLine && (
        <div className="native-communication-actions">
          <Select
            aria-label="確認事項"
            value={purpose}
            disabled={disabled}
            onChange={(value) => {
              setPurpose(value);
              setBindingId(undefined);
            }}
            options={Object.entries(confirmationLabels).map(
              ([value, label]) => ({ value, label }),
            )}
          />
          {["PRODUCT", "DISPOSITION"].includes(purpose) && (
            <Select
              aria-label="確認品項"
              placeholder="選擇實物"
              disabled={disabled}
              value={bindingId || bindings[0]?.itemId}
              onChange={setBindingId}
              options={bindings.map((row) => ({
                value: row.itemId,
                label: row.label || row.itemId,
              }))}
            />
          )}
          <Button
            data-operation-action="after_sales.confirmation.create"
            loading={busy}
            disabled={
              !!pending ||
              unknown || brandPending ||
              (["PRODUCT", "DISPOSITION"].includes(purpose) && !bindings.length)
            }
            onClick={() => void createConfirmation()}
          >
            建立顧客確認連結
          </Button>
        </div>
      )}
      {visibleLink && (
        <div className="native-confirmation-link">
          <Tag>{confirmationLabels[visibleLink.purpose]}</Tag>
          <Input aria-label="顧客確認連結" readOnly value={visibleLink.url} />
          <Button
            data-operation-action="after_sales.confirmation.copy"
            onClick={() => void copyLink(visibleLink.url!)}
          >
            複製連結
          </Button>
        </div>
      )}
      <Collapse
        ghost
        className="native-communication-sections"
        activeKey={
          params.get("caseActivity")
            ? [params.get("caseActivity")!]
            : allConfirmations.some((row) => row.status === "SUBMITTED")
              ? ["confirmations"]
              : proposed
                ? ["proposals"]
                : factory
                  ? ["factory"]
                  : []
        }
        onChange={(keys) =>
          selectActivity((Array.isArray(keys) ? keys.at(-1) : keys) || "")
        }
        items={[
          {
            key: "confirmations",
            label: `顧客確認${allConfirmations.length ? " · " + allConfirmations.length : ""}`,
            children: (
              <>
                {!allConfirmations.length ? (
                  <p className="native-communication-empty">尚無顧客確認</p>
                ) : (
                  allConfirmations.map((row) => (
                    <div className="native-communication-record" key={row.id}>
                      <Space wrap>
                        <strong>{confirmationLabels[row.purpose]}</strong>
                        <Tag>
                          {confirmationStatuses[row.status] || row.status}
                        </Tag>
                        {row.identityProvider === "DEV_STUB" && (
                          <Tag>DEV 模擬登入</Tag>
                        )}
                        <span>第 {row.revision} 版</span>
                        {row.status === "SUBMITTED" && canLine && (
                          <Button
                            data-operation-action="after_sales.confirmation.review"
                            disabled={disabled}
                            onClick={() => reviewConfirmation(row)}
                          >
                            審核資料
                          </Button>
                        )}
                        {row.url && row.status === "PENDING" && (
                          <Button
                            data-operation-action="after_sales.confirmation.copy_existing"
                            onClick={() => void copyLink(row.url!)}
                          >
                            複製連結
                          </Button>
                        )}
                      </Space>
                      {row.submittedData && (
                        <p>
                          {row.submittedData.name} ·{" "}
                          {row.submittedData.productDescription ||
                            row.submittedData.decision}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </>
            ),
          },
          ...(detail.type === "REPAIR"
            ? [
                {
                  key: "proposals",
                  label: `維修提案${proposals.length ? " · " + proposals.length : ""}`,
                  children: (
                    <>
                      {proposals.map((row) => (
                        <article
                          className="native-communication-record"
                          key={row.id}
                        >
                          <Space wrap>
                            <strong>
                              {row.proposal?.original.productName ||
                                "品項待核對"}
                            </strong>
                            <Tag>
                              {planLabels[row.proposal?.plan || ""] ||
                                row.proposal?.plan}
                            </Tag>
                            <Tag>
                              {row.status === "ADOPTED"
                                ? "已採用"
                                : "待客服審核"}
                            </Tag>
                            <span>
                              {row.proposal?.amount === null
                                ? "費用待確認"
                                : `${row.proposal?.currency} ${row.proposal?.amount}`}
                            </span>
                          </Space>
                          <p>{row.proposal?.summary}</p>
                          <div className="native-communication-muted">
                            {[
                              row.proposal?.original.sku,
                              row.proposal?.original.serialNumber &&
                                "SN " + row.proposal.original.serialNumber,
                              "方案第 " + row.planVersion + " 版",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </article>
                      ))}
                      {proposalError && (
                        <p className="native-communication-muted">
                          {proposalError}
                        </p>
                      )}
                      {proposed && canLine && (
                        <Button
                          data-operation-action="after_sales.proposals.adopt"
                          disabled={disabled || !!proposalError}
                          onClick={() =>
                            void run("repair-proposals/adopt", {
                              proposalIds: proposals.map((row) => row.id),
                              expectedUpdatedAt: detail.updatedAt,
                            })
                          }
                        >
                          採用全部本版提案
                        </Button>
                      )}
                    </>
                  ),
                },
              ]
            : []),
          {
            key: "notifications",
            label: `LINE 通知${notifications.length ? " · " + notifications.length : ""}`,
            children: (
              <>
                {canLine && (
                  <Button
                    data-operation-action="after_sales.notification.compose"
                    disabled={disabled}
                    onClick={composeNotification}
                  >
                    新增通知草稿
                  </Button>
                )}
                {!notifications.length ? (
                  <p className="native-communication-empty">尚無顧客通知</p>
                ) : (
                  notifications.map((row) => (
                    <div className="native-communication-record" key={row.id}>
                      <Space wrap>
                        <strong>
                          {notificationTypes[row.type] || row.type}
                        </strong>
                        <Tag
                          color={
                            row.status === "FAILED"
                              ? "red"
                              : row.status === "UNKNOWN"
                                ? "gold"
                                : undefined
                          }
                        >
                          {notificationStatuses[row.status] || row.status}
                        </Tag>
                        <span>{row.brand}</span>
                        {row.provider === 'CORELY_AI' && <Tag>AI 客服</Tag>}
                        <Button
                          data-operation-action="after_sales.notification.preview"
                          onClick={() => setNotification(row)}
                        >
                          查看
                        </Button>
                      </Space>
                    </div>
                  ))
                )}
              </>
            ),
          },
          ...(detail.type === "CUSTOMER_ISSUE"
            ? [
                {
                  key: "factory",
                  label: "工廠問題交辦",
                  children: (
                    <>
                      {factory ? (
                        <>
                          <Space wrap>
                            <strong>{factory.factoryName}</strong>
                            <Tag>
                              {factoryStatuses[factory.status] ||
                                factory.status}
                            </Tag>
                            <span>
                              {factory.assigneeName ||
                                options?.factoryAssignees?.find(
                                  (person) =>
                                    person.value === factory.assigneeId,
                                )?.label ||
                                "指定接手人員"}
                            </span>
                          </Space>
                          <p>{factory.issueSummary}</p>
                          {factory.reply && <p>工廠回覆：{factory.reply}</p>}
                          {factory.resolution && (
                            <p>核定結果：{factory.resolution}</p>
                          )}
                        </>
                      ) : (
                        <p className="native-communication-empty">
                          尚未交辦工廠
                        </p>
                      )}
                      {canFactoryOwner && (
                        <Space wrap>
                          {!factory && (
                            <Button
                              data-operation-action="after_sales.factory.assign"
                              disabled={disabled}
                              onClick={() => editFactory("ASSIGN")}
                            >
                              交辦工廠
                            </Button>
                          )}
                          {factory?.status === "ASSIGNED" && (
                            <Button
                              data-operation-action="after_sales.factory.accept"
                              disabled={disabled}
                              onClick={() =>
                                void run("factory-actions", {
                                  action: "ACCEPT",
                                  expectedRevision: factory.revision,
                                })
                              }
                            >
                              接手交辦
                            </Button>
                          )}
                          {factory?.status === "ACCEPTED" && (
                            <Button
                              data-operation-action="after_sales.factory.reply"
                              disabled={disabled}
                              onClick={() => editFactory("REPLY")}
                            >
                              記錄工廠回覆
                            </Button>
                          )}
                          {factory?.status === "REPLIED" && (
                            <Button
                              data-operation-action="after_sales.factory.close"
                              disabled={disabled}
                              onClick={() => editFactory("CLOSE")}
                            >
                              核定結案
                            </Button>
                          )}
                        </Space>
                      )}
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Drawer
        title={
          compose ? "新增通知草稿" : notification?.payload.title || "LINE 通知"
        }
        open={compose || !!notification}
        onClose={() => {
          if (busy) return;
          setCompose(false);
          setNotification(undefined);
          onDirtyChange(false);
        }}
        width="min(520px, 100vw)"
        footer={
          compose ? (
            <Button
              data-operation-action="after_sales.notification.create"
              type="primary"
              disabled={disabled}
              onClick={() => void submitNotification()}
            >
              建立草稿
            </Button>
          ) : notification && canLine ? (
            <Space>
              {notification.status === "DRAFT" && (
                <Button
                  data-operation-action="after_sales.notification.approve"
                  type="primary"
                  disabled={disabled}
                  onClick={() =>
                    void run("communications", {
                      operation: "APPROVE_NOTIFICATION",
                      notificationId: notification.id,
                    })
                  }
                >
                  審核通過
                </Button>
              )}
              {activeNotificationAction?.kind === 'POLL' && (
                <Button
                  data-operation-action="after_sales.notification.refresh"
                  disabled={disabled}
                  onClick={() =>
                    void run("communications", {
                      operation: "SEND_NOTIFICATION",
                      notificationId: notification.id,
                      receiptOnly: true,
                    })
                  }
                >
                  {activeNotificationAction.label}
                </Button>
              )}
              {activeNotificationAction?.kind === 'SEND' && (
                <Button
                  data-operation-action="after_sales.notification.send"
                  type="primary"
                  disabled={disabled}
                  onClick={() => void run("communications", { operation: "SEND_NOTIFICATION", notificationId: notification.id })}
                >
                  {activeNotificationAction.label}
                </Button>
              )}
            </Space>
          ) : undefined
        }
      >
        {compose ? (
          <Form
            form={notificationForm}
            layout="vertical"
            onValuesChange={() => onDirtyChange(true)}
          >
            <Form.Item
              name="type"
              label="通知事項"
              rules={[{ required: true }]}
            >
              <Select
                options={Object.entries(notificationTypes).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
            </Form.Item>
            <Form.Item
              name="title"
              label="卡片標題"
              rules={[{ required: true }]}
            >
              <Input maxLength={80} />
            </Form.Item>
            <Form.Item
              name="text"
              label="通知內容"
              rules={[{ required: true }]}
            >
              <Input.TextArea rows={6} maxLength={2000} />
            </Form.Item>
          </Form>
        ) : (
          notification && (
            <>
              <Tag>
                {notificationStatuses[notification.status] ||
                  notification.status}
              </Tag>
              {notification.provider === 'CORELY_AI' && <Tag>AI 客服</Tag>}
              <div className="native-notification-preview">
                <h4>{notification.payload.title}</h4>
                <p>{notification.payload.text}</p>
                {notification.payload.actionUrl && (
                  <span>{notification.payload.actionLabel || "查看進度"}</span>
                )}
              </div>
              {notification.providerReceiptId && (
                <p className="native-communication-muted">
                  發送回執：{notification.providerReceiptId}
                </p>
              )}
              {notification.lastErrorCode && (
                <p className="native-communication-muted">
                  {notification.lastErrorCode}
                </p>
              )}
            </>
          )
        )}
      </Drawer>
      <Drawer
        title="審核顧客資料"
        open={!!review}
        width="min(520px, 100vw)"
        onClose={() => {
          if (!busy) {
            setReview(undefined);
            onDirtyChange(false);
          }
        }}
        footer={
          <Space>
            <Button
              data-operation-action="after_sales.confirmation.reject"
              disabled={disabled}
              onClick={() => void submitReview(false)}
            >
              退回確認
            </Button>
            <Button
              data-operation-action="after_sales.confirmation.approve"
              type="primary"
              disabled={disabled}
              onClick={() => void submitReview(true)}
            >
              審核通過
            </Button>
          </Space>
        }
      >
        {review?.submittedData && (
          <>
            <Tag>{confirmationLabels[review.purpose]}</Tag>
            <Descriptions
              column={1}
              items={Object.entries({
                姓名: review.submittedData.name,
                電話: review.submittedData.phone,
                地址: review.submittedData.address,
                Email: review.submittedData.email,
                產品描述: review.submittedData.productDescription,
                故障描述: review.submittedData.faultDescription,
                顧客回覆:
                  (
                    {
                      CONFIRM: "確認資料",
                      DECLINE: "不同意",
                      RETURN_ORIGINAL: "寄回原件",
                      SCRAP: "同意報廢",
                    } as Record<string, string>
                  )[review.submittedData.decision || ""] ||
                  review.submittedData.decision,
              })
                .filter(([, value]) => value)
                .map(([label, value]) => ({
                  key: label,
                  label,
                  children: value,
                }))}
            />
            <Space wrap>
              {review.submittedData.photos?.map((p) => (
                <Button
                  key={p.index}
                  data-operation-action="after_sales.confirmation.photo"
                  onClick={() => void openPhoto(review, p.index)}
                >
                  {p.name || "照片 " + (p.index + 1)}
                </Button>
              ))}
            </Space>
            <Form layout="vertical">
              <Form.Item label="審核備註" required>
                <Input.TextArea
                  aria-label="審核備註"
                  value={reviewNote}
                  onChange={(event) => {
                    setReviewNote(event.target.value);
                    onDirtyChange(true);
                  }}
                  maxLength={2000}
                  rows={3}
                />
              </Form.Item>
            </Form>
          </>
        )}
      </Drawer>
      <Drawer
        title={
          factoryEdit === "ASSIGN"
            ? "交辦工廠"
            : factoryEdit === "REPLY"
              ? "工廠回覆"
              : "核定結案"
        }
        open={!!factoryEdit}
        onClose={() => {
          if (!busy) {
            setFactoryEdit(undefined);
            onDirtyChange(false);
          }
        }}
        width="min(520px, 100vw)"
        footer={
          <Button
            data-operation-action="after_sales.factory.submit"
            type="primary"
            disabled={disabled}
            onClick={() => void submitFactory()}
          >
            儲存
          </Button>
        }
      >
        <Form
          form={factoryForm}
          layout="vertical"
          onValuesChange={() => onDirtyChange(true)}
        >
          {factoryEdit === "ASSIGN" ? (
            <>
              <Form.Item
                label="工廠名稱"
                name="factoryName"
                rules={[{ required: true }]}
              >
                <Input maxLength={120} />
              </Form.Item>
              <Form.Item
                label="接手人員"
                name="assigneeId"
                rules={[{ required: true }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={options?.factoryAssignees || []}
                />
              </Form.Item>
              <Form.Item
                label="問題摘要"
                name="issueSummary"
                rules={[{ required: true }]}
              >
                <Input.TextArea rows={5} maxLength={4000} />
              </Form.Item>
            </>
          ) : factoryEdit === "REPLY" ? (
            <Form.Item
              label="工廠回覆"
              name="reply"
              rules={[{ required: true }]}
            >
              <Input.TextArea rows={6} maxLength={4000} />
            </Form.Item>
          ) : (
            <Form.Item
              label="核定處理結果"
              name="resolution"
              rules={[{ required: true }]}
            >
              <Input.TextArea rows={6} maxLength={4000} />
            </Form.Item>
          )}
        </Form>
      </Drawer>
      <Drawer
        title={photo?.name || "產品照片"}
        open={!!photo}
        onClose={() => setPhoto(undefined)}
        width="min(600px, 100vw)"
      >
        {photo && <Image src={photo.dataUrl} alt={photo.name} />}
      </Drawer>
    </section>
  );
}
