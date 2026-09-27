import { useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  CreditCard,
  Eye,
  EyeOff,
  Fingerprint,
  Home as HomeIcon,
  Landmark,
  LayoutDashboard,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Smartphone,
  UserRound,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";

type View = "inicio" | "actividad" | "cuentas" | "seguridad" | "admin";
type FlowMode = "send" | "request" | null;
type FlowStep = "amount" | "recipient" | "review" | "auth" | "success";
type TransactionType = "in" | "out";
type SecurityContext = { deviceFingerprint: string; sessionFingerprint: string; deviceLabel: string; platform: string };

type Transfer = {
  id: string;
  person: string;
  handle: string;
  amount: number;
  type: TransactionType;
  time: string;
  status: "Completado" | "Pendiente" | "Verificando" | "Rechazado" | "Expirado" | "Fallido" | "Cancelado" | "Solicitado";
  icon: string;
  color: string;
};

const initialTransfers: Transfer[] = [
  { id: "TX-20260925-8F72", person: "Carlos M.", handle: "@carlos", amount: 500, type: "out", time: "Hoy · 10:42", status: "Pendiente", icon: "CM", color: "coral" },
  { id: "TX-20260925-3K90", person: "María R.", handle: "@maria", amount: 750, type: "in", time: "Ayer · 16:15", status: "Completado", icon: "MR", color: "lilac" },
  { id: "TX-20260924-5P21", person: "Juan P.", handle: "@juan", amount: 125, type: "out", time: "Ayer · 09:08", status: "Rechazado", icon: "JP", color: "amber" },
  { id: "TX-20260923-2D31", person: "Sofía A.", handle: "@sofia", amount: 300, type: "in", time: "23 sep · 18:02", status: "Expirado", icon: "SA", color: "sky" },
];

const contacts = [
  { name: "Carlos M.", handle: "@carlos", initials: "CM", note: "En tus contactos", color: "coral" },
  { name: "María R.", handle: "@maria", initials: "MR", note: "En tus contactos", color: "lilac" },
  { name: "Juan P.", handle: "@juan", initials: "JP", note: "En tus contactos", color: "amber" },
];

const navItems: { id: View; label: string; icon: typeof HomeIcon }[] = [
  { id: "inicio", label: "Inicio", icon: HomeIcon },
  { id: "actividad", label: "Actividad", icon: Activity },
  { id: "cuentas", label: "Mis cuentas", icon: Landmark },
  { id: "seguridad", label: "Seguridad", icon: ShieldCheck },
];

const formatMoney = (value: number) =>
  new Intl.NumberFormat("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

const statusFromApi = (status: string): Transfer["status"] => {
  if (status === "settled") return "Completado";
  if (status === "processing" || status === "authorized") return "Pendiente";
  if (status === "created" || status === "authenticating" || status === "risk_review") return "Verificando";
  if (status === "declined") return "Rechazado";
  if (status === "expired") return "Expirado";
  if (status === "failed") return "Fallido";
  if (status === "canceled") return "Cancelado";
  return "Solicitado";
};

function createSecurityContext(): SecurityContext {
  const deviceKey = "lira-sandbox-device-id";
  const sessionKey = "lira-sandbox-session-id";
  const next = () => crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g, "");
  const storedDevice = typeof window === "undefined" ? next() : localStorage.getItem(deviceKey) || next();
  const storedSession = typeof window === "undefined" ? next() : sessionStorage.getItem(sessionKey) || next();
  if (typeof window !== "undefined") {
    localStorage.setItem(deviceKey, storedDevice);
    sessionStorage.setItem(sessionKey, storedSession);
  }
  const platform = typeof navigator === "undefined" ? "Navegador" : navigator.platform || "Navegador";
  return { deviceFingerprint: storedDevice, sessionFingerprint: storedSession, deviceLabel: "Este navegador", platform: platform.slice(0, 80) };
}

const avatarColorFor = (value: string) => ["coral", "lilac", "amber", "sky"][value.length % 4];

function mapApiTransfer(raw: { id: string; reference: string; senderUserId: number; recipientUserId: number | null; recipientHandle: string; amountMinor: number; status: string; createdAt: Date }, currentUserId: number): Transfer {
  const isOutgoing = raw.senderUserId === currentUserId;
  const handle = isOutgoing ? raw.recipientHandle : "@lira-sandbox";
  const person = isOutgoing ? handle.replace(/^@/, "").replace(/(^|[_-])(\w)/g, (_, gap, letter) => `${gap ? " " : ""}${letter.toUpperCase()}`) : "Fondos sandbox";
  return {
    id: raw.reference || raw.id,
    person,
    handle,
    amount: raw.amountMinor / 100,
    type: isOutgoing ? "out" : "in",
    time: new Date(raw.createdAt).toLocaleString("es-HN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
    status: statusFromApi(raw.status),
    icon: person.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase(),
    color: avatarColorFor(handle),
  };
}

function Avatar({ initials, color = "mint", size = "md" }: { initials: string; color?: string; size?: "sm" | "md" | "lg" }) {
  return <span className={`avatar avatar-${color} avatar-${size}`}>{initials}</span>;
}

function StatusPill({ status }: { status: Transfer["status"] }) {
  const isDone = status === "Completado";
  const isProgress = status === "Pendiente" || status === "Verificando";
  const isAlert = status === "Rechazado" || status === "Fallido" || status === "Expirado" || status === "Cancelado";
  return (
    <span className={`status-pill ${isDone ? "status-complete" : isProgress ? "status-progress" : isAlert ? "status-alert" : "status-request"}`}>
      {isDone && <CheckCircle2 size={13} />}
      {isProgress && <Clock3 size={13} />}
      {isAlert && <CircleAlert size={13} />}
      {status}
    </span>
  );
}

function Money({ value, type, hide = false }: { value: number; type?: TransactionType; hide?: boolean }) {
  if (hide) return <span className="money-hidden">••••••</span>;
  const prefix = type === "in" ? "+" : type === "out" ? "−" : "";
  return <span className={type === "in" ? "money-in" : type === "out" ? "money-out" : ""}>{prefix}L {formatMoney(value)}</span>;
}

export default function Home() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const utils = trpc.useUtils();
  const [activeView, setActiveView] = useState<View>("inicio");
  const [flowMode, setFlowMode] = useState<FlowMode>(null);
  const [flowStep, setFlowStep] = useState<FlowStep>("amount");
  const [securityContext] = useState<SecurityContext>(createSecurityContext);
  const [amount, setAmount] = useState("500");
  const [selectedContact, setSelectedContact] = useState(contacts[0]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [biometricsEnabled, setBiometricsEnabled] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [latestReference, setLatestReference] = useState("TX-SANDBOX-PENDIENTE");
  const [latestStatus, setLatestStatus] = useState<Transfer["status"]>("Completado");
  const [operationError, setOperationError] = useState<string | null>(null);
  const [verificationChallengeId, setVerificationChallengeId] = useState<string | null>(null);
  const [sandboxOtpCode, setSandboxOtpCode] = useState<string | null>(null);
  const [pinCode, setPinCode] = useState("");
  const [otpCode, setOtpCode] = useState("");

  const dashboardQuery = trpc.finance.dashboard.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const transferMutation = trpc.finance.createTransfer.useMutation();
  const requestMutation = trpc.finance.createPaymentRequest.useMutation();
  const startVerificationMutation = trpc.security.startTransferVerification.useMutation();
  const verifyTransferMutation = trpc.security.verifyTransfer.useMutation();

  const numericAmount = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  const amountMinor = Math.round(numericAmount * 100);
  const apiTransfers = dashboardQuery.data?.recentTransfers ?? [];
  const transfers = user && apiTransfers.length > 0 ? apiTransfers.map((transfer) => mapApiTransfer(transfer, user.id)) : initialTransfers;
  const balance = dashboardQuery.data ? dashboardQuery.data.balanceMinor / 100 : 3250;
  const incomingTotal = transfers.filter((transfer) => transfer.type === "in").reduce((total, transfer) => total + transfer.amount, 0);
  const outgoingTotal = transfers.filter((transfer) => transfer.type === "out").reduce((total, transfer) => total + transfer.amount, 0);
  const attentionTransfers = transfers.filter((transfer) => ["Pendiente", "Verificando", "Rechazado", "Expirado", "Fallido", "Cancelado"].includes(transfer.status));
  const filteredContacts = useMemo(
    () => contacts.filter((contact) => `${contact.name} ${contact.handle}`.toLowerCase().includes(recipientSearch.toLowerCase())),
    [recipientSearch],
  );

  const openFlow = (mode: Exclude<FlowMode, null>) => {
    if (!isAuthenticated) {
      toast.message("Inicia sesión para operar en el sandbox financiero.");
      startLogin();
      return;
    }
    setFlowMode(mode);
    setFlowStep("amount");
    setAmount(mode === "send" ? "500" : "250");
    setRecipientSearch("");
    setOperationError(null);
    setVerificationChallengeId(null);
    setSandboxOtpCode(null);
    setPinCode("");
    setOtpCode("");
  };

  const closeFlow = () => {
    setFlowMode(null);
    setFlowStep("amount");
    setIsWorking(false);
    setOperationError(null);
    setVerificationChallengeId(null);
    setSandboxOtpCode(null);
    setPinCode("");
    setOtpCode("");
  };

  const beginTransferVerification = async () => {
    if (!isAuthenticated || flowMode !== "send") return;
    setIsWorking(true);
    setOperationError(null);
    try {
      const challenge = await startVerificationMutation.mutateAsync(securityContext);
      setVerificationChallengeId(challenge.challengeId);
      setSandboxOtpCode(challenge.sandboxCode);
      setFlowStep("auth");
      toast.message("Código OTP generado para esta operación simulada.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible iniciar la verificación";
      setOperationError(message);
      toast.error(message);
    } finally {
      setIsWorking(false);
    }
  };

  const completeTransfer = async () => {
    if (!isAuthenticated || !user) return;
    setIsWorking(true);
    setOperationError(null);
    const idempotencyKey = `ui-${crypto.randomUUID()}`;
    try {
      if (flowMode === "send") {
        if (!verificationChallengeId) throw new Error("Solicita un código de verificación antes de enviar");
        await verifyTransferMutation.mutateAsync({ ...securityContext, challengeId: verificationChallengeId, pin: pinCode, code: otpCode });
        const result = await transferMutation.mutateAsync({ amountMinor, currency: "HNL", recipientHandle: selectedContact.handle, idempotencyKey, verificationChallengeId, sessionFingerprint: securityContext.sessionFingerprint });
        setLatestReference(result.transfer.reference);
        setLatestStatus(statusFromApi(result.transfer.status));
        toast.success(result.replayed ? "Operación recuperada sin duplicar el envío" : "Transferencia registrada en el sandbox");
      } else {
        const result = await requestMutation.mutateAsync({ amountMinor, currency: "HNL", recipientHandle: selectedContact.handle, idempotencyKey });
        setLatestReference(`REQ-${result.request.id.slice(0, 8).toUpperCase()}`);
        setLatestStatus("Solicitado");
        toast.success(result.replayed ? "Solicitud recuperada sin duplicarla" : "Solicitud creada en el sandbox");
      }
      await utils.finance.dashboard.invalidate();
      setFlowStep("success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible completar la operación";
      setOperationError(message);
      setFlowStep("review");
      toast.error(message);
    } finally {
      setIsWorking(false);
    }
  };

  const renderContent = () => {
    if (activeView === "actividad") {
      return <ActivityView transfers={transfers} onSend={() => openFlow("send")} />;
    }
    if (activeView === "cuentas") {
      return <AccountsView accounts={dashboardQuery.data?.accounts ?? []} balance={balance} />;
    }
    if (activeView === "seguridad") {
      return <SecurityView securityContext={securityContext} biometricsEnabled={biometricsEnabled} onToggle={() => setBiometricsEnabled((value) => !value)} />;
    }
    if (activeView === "admin") {
      return <AdminView />;
    }
    return (
      <>
        <section className="page-heading welcome-heading">
          <div>
            <div className="eyebrow"><span className="live-dot" /> OPERACIÓN SIMULADA</div>
            <h1>Buenos días, {user?.name?.split(" ")[0] || "Daniela"}</h1>
            <p>{isAuthenticated ? "Tu saldo se reconstruye desde el ledger del sandbox." : "Inicia sesión para activar el sandbox financiero."}</p>
          </div>
          <button className="icon-button notification-button" aria-label="Ver notificaciones"><Bell size={20} /><span /></button>
        </section>

        <section className="balance-card">
          <div className="balance-glow balance-glow-one" />
          <div className="balance-glow balance-glow-two" />
          <div className="balance-card-top">
            <div className="balance-label"><WalletCards size={17} /> Disponible para usar</div>
            <button className="eye-button" onClick={() => setBalanceVisible((visible) => !visible)} aria-label="Mostrar u ocultar saldo">
              {balanceVisible ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
          <div className="balance-value"><Money value={balance} hide={!balanceVisible} /></div>
          <div className="balance-card-bottom">
            <span>{dashboardQuery.data ? `${dashboardQuery.data.accounts.length} cuenta${dashboardQuery.data.accounts.length === 1 ? "" : "s"} vinculada${dashboardQuery.data.accounts.length === 1 ? "" : "s"}` : "En bancos vinculados"}</span>
            <span className="secure-line"><ShieldCheck size={15} /> Sandbox · sin dinero real</span>
          </div>
        </section>

        <section className="quick-actions" aria-label="Acciones rápidas">
          <button className="quick-action request-action" onClick={() => openFlow("request")}>
            <span className="quick-action-icon"><ArrowDownLeft size={24} /></span>
            <span><strong>Solicitar</strong><small>Cobra en segundos</small></span>
            <ChevronRight size={18} />
          </button>
          <button className="quick-action send-action" onClick={() => openFlow("send")}>
            <span className="quick-action-icon"><Send size={22} /></span>
            <span><strong>Enviar</strong><small>Con confirmación segura</small></span>
            <ChevronRight size={18} />
          </button>
        </section>

        {attentionTransfers.length > 0 && <section className="transaction-alert-banner"><div className="transaction-alert-icon"><CircleAlert size={20} /></div><div><strong>{attentionTransfers.length === 1 ? "1 operación requiere" : `${attentionTransfers.length} operaciones requieren`} atención</strong><p>Revisa los estados pendientes, rechazados o expirados antes de intentar una nueva operación.</p></div><button className="link-button" onClick={() => setActiveView("actividad")}>Ver actividad <ChevronRight size={16} /></button></section>}

        <section className="content-grid">
          <div className="panel activity-panel">
            <div className="panel-heading">
              <div><span className="section-kicker">TU MOVIMIENTO</span><h2>Actividad reciente</h2></div>
              <button className="link-button" onClick={() => setActiveView("actividad")}>Ver todo <ChevronRight size={16} /></button>
            </div>
            <div className="transaction-list">
              {transfers.slice(0, 4).map((transfer) => <TransactionRow key={transfer.id} transfer={transfer} />)}
            </div>
          </div>

          <div className="panel insight-panel">
            <div className="panel-heading compact-heading">
              <div><span className="section-kicker">RESUMEN</span><h2>Tu semana</h2></div>
              <button className="icon-button subtle" aria-label="Más opciones"><MoreHorizontal size={19} /></button>
            </div>
            <div className="week-visual" aria-label="Actividad de los últimos siete días">
              {[36, 52, 31, 76, 42, 88, 57].map((height, index) => <span key={index} className={index === 5 ? "bar active-bar" : "bar"} style={{ height: `${height}%` }} />)}
            </div>
            <div className="week-labels"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
            <div className="insight-summary"><div><span>Entró</span><strong className="money-in">+ L {formatMoney(incomingTotal)}</strong></div><div><span>Salió</span><strong className="money-out">− L {formatMoney(outgoingTotal)}</strong></div></div>
          </div>
        </section>

        {dashboardQuery.error && <section className="data-warning"><CircleAlert size={18} /><span>No fue posible sincronizar la capa financiera. Las operaciones siguen bloqueadas hasta recuperar la conexión.</span></section>}
        <section className="security-strip">
          <div className="security-icon"><Fingerprint size={23} /></div>
          <div><strong>Controles del sandbox</strong><p>{isAuthenticated ? "Auditoría, idempotencia y ledger activo para operaciones simuladas." : "Inicia sesión para habilitar operaciones trazables en el sandbox."}</p></div>
          <button className="link-button" onClick={() => setActiveView("seguridad")}>Revisar <ChevronRight size={16} /></button>
        </section>
      </>
    );
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">L</span><span>LIRA</span></div>
        <div className="sandbox-chip"><span /> SANDBOX FINANCIERO</div>
        <nav className="main-nav" aria-label="Navegación principal">
          {navItems.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={activeView === item.id ? "nav-item active" : "nav-item"} onClick={() => setActiveView(item.id)}><Icon size={19} />{item.label}</button>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <button className={activeView === "admin" ? "admin-switch active" : "admin-switch"} onClick={() => setActiveView("admin")}><LayoutDashboard size={18} /> Centro de control <ChevronRight size={15} /></button>
          <div className="profile-card"><Avatar initials={(user?.name || "DP").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()} color="navy" size="sm" /><div><strong>{user?.name || "Daniela P."}</strong><span>{isAuthenticated ? "Sesión protegida" : "Modo de vista"}</span></div><ChevronDown size={16} /></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="mobile-header"><div className="brand"><span className="brand-mark">L</span><span>LIRA</span></div><button className="icon-button" aria-label="Notificaciones"><Bell size={19} /></button></header>
        <div className="content-wrap">{renderContent()}</div>
      </main>

      <nav className="mobile-nav" aria-label="Navegación móvil">
        {navItems.slice(0, 4).map((item) => { const Icon = item.icon; return <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => setActiveView(item.id)}><Icon size={19} /><span>{item.label}</span></button>; })}
      </nav>

      {flowMode && <PaymentFlow
        mode={flowMode}
        step={flowStep}
        amount={amount}
        numericAmount={numericAmount}
        selectedContact={selectedContact}
        recipientSearch={recipientSearch}
        contacts={filteredContacts}
        isWorking={isWorking}
        latestReference={latestReference}
        latestStatus={latestStatus}
        operationError={operationError}
        verificationChallengeId={verificationChallengeId}
        sandboxOtpCode={sandboxOtpCode}
        pinCode={pinCode}
        otpCode={otpCode}
        onClose={closeFlow}
        onAmountChange={setAmount}
        onSearchChange={setRecipientSearch}
        onContactSelect={setSelectedContact}
        onStepChange={setFlowStep}
        onBeginVerification={beginTransferVerification}
        onPinChange={setPinCode}
        onOtpChange={setOtpCode}
        onConfirm={completeTransfer}
      />}
    </div>
  );
}

function TransactionRow({ transfer }: { transfer: Transfer }) {
  return <div className="transaction-row">
    <Avatar initials={transfer.icon} color={transfer.color} />
    <div className="transaction-person"><strong>{transfer.person}</strong><span>{transfer.type === "in" ? "Recibiste dinero" : "Enviaste dinero"} · {transfer.time}</span></div>
    <div className="transaction-amount"><strong><Money value={transfer.amount} type={transfer.type} /></strong><StatusPill status={transfer.status} /></div>
  </div>;
}

function PaymentFlow({ mode, step, amount, numericAmount, selectedContact, recipientSearch, contacts: visibleContacts, isWorking, latestReference, latestStatus, operationError, verificationChallengeId, sandboxOtpCode, pinCode, otpCode, onClose, onAmountChange, onSearchChange, onContactSelect, onStepChange, onBeginVerification, onPinChange, onOtpChange, onConfirm }: {
  mode: Exclude<FlowMode, null>;
  step: FlowStep;
  amount: string;
  numericAmount: number;
  selectedContact: typeof contacts[number];
  recipientSearch: string;
  contacts: typeof contacts;
  isWorking: boolean;
  latestReference: string;
  latestStatus: Transfer["status"];
  operationError: string | null;
  verificationChallengeId: string | null;
  sandboxOtpCode: string | null;
  pinCode: string;
  otpCode: string;
  onClose: () => void;
  onAmountChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onContactSelect: (contact: typeof contacts[number]) => void;
  onStepChange: (step: FlowStep) => void;
  onBeginVerification: () => void | Promise<void>;
  onPinChange: (value: string) => void;
  onOtpChange: (value: string) => void;
  onConfirm: () => void | Promise<void>;
}) {
  const isSend = mode === "send";
  const verb = isSend ? "Enviar" : "Solicitar";
  const successVerb = isSend ? (latestStatus === "Completado" ? "enviados" : "recibidos para procesamiento") : "solicitados";
  const reference = latestReference;

  return <div className="flow-backdrop" role="dialog" aria-modal="true" aria-label={`${verb} dinero`}>
    <section className="payment-flow">
      <header className="flow-header">
        <div><span className="section-kicker">{step === "success" ? "OPERACIÓN REGISTRADA" : `NUEVA OPERACIÓN · ${isSend ? "ENVÍO" : "SOLICITUD"}`}</span><h2>{step === "success" ? "Todo listo" : verb + " dinero"}</h2></div>
        <button className="icon-button subtle" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
      </header>
      {step !== "success" && <div className="flow-progress"><span className={step === "amount" ? "current" : "done"} /><span className={step === "recipient" ? "current" : step === "review" || step === "auth" ? "done" : ""} /><span className={step === "review" || step === "auth" ? "current" : ""} /></div>}

      {step === "amount" && <div className="flow-body amount-body">
        <p className="flow-question">¿Cuánto quieres {isSend ? "enviar" : "solicitar"}?</p>
        <div className="amount-input-wrap"><span>L</span><input value={amount} inputMode="decimal" onChange={(event) => onAmountChange(event.target.value.replace(/[^0-9.]/g, ""))} autoFocus /><small>.00</small></div>
        <div className="amount-shortcuts">{[100, 250, 500, 1000].map((value) => <button key={value} className={Number(amount) === value ? "selected" : ""} onClick={() => onAmountChange(String(value))}>L {value}</button>)}</div>
        {isSend && <div className={numericAmount > 1000 ? "flow-error" : "flow-limit-notice"}><ShieldCheck size={17} /><span>{numericAmount > 1000 ? "El límite preventivo del sandbox es L 1,000.00 por envío." : "Límite preventivo: L 1,000.00 por envío; el límite diario se valida en el servidor."}</span></div>}
        <div className="source-note"><Landmark size={18} /><div><strong>Banco Uno ·••••8421</strong><span>Cuenta simulada · L 3,250.00 disponible</span></div><ChevronRight size={17} /></div>
        <button className="primary-button full-width" disabled={numericAmount <= 0 || (isSend && numericAmount > 1000)} onClick={() => onStepChange("recipient")}>Continuar <ChevronRight size={18} /></button>
      </div>}

      {step === "recipient" && <div className="flow-body">
        <p className="flow-question">¿A quién quieres {isSend ? "enviar" : "solicitar"}?</p>
        <label className="search-field"><Search size={19} /><input value={recipientSearch} onChange={(event) => onSearchChange(event.target.value)} placeholder="Teléfono o @usuario" autoFocus /></label>
        <p className="muted-label">TUS CONTACTOS</p>
        <div className="contact-list">{visibleContacts.map((contact) => <button className={selectedContact.handle === contact.handle ? "contact-option selected" : "contact-option"} key={contact.handle} onClick={() => onContactSelect(contact)}><Avatar initials={contact.initials} color={contact.color} /><span><strong>{contact.name}</strong><small>{contact.handle} · {contact.note}</small></span>{selectedContact.handle === contact.handle && <CheckCircle2 className="select-check" size={20} />}</button>)}</div>
        <div className="flow-footer"><button className="back-button" onClick={() => onStepChange("amount")}>Atrás</button><button className="primary-button" onClick={() => onStepChange("review")}>Revisar <ChevronRight size={18} /></button></div>
      </div>}

      {step === "review" && <div className="flow-body review-body">
        <p className="flow-question">Revisa antes de confirmar</p>
        <div className="review-amount"><span>{isSend ? "Enviarás" : "Solicitarás"}</span><strong>L {formatMoney(numericAmount)}</strong></div>
        <div className="review-card"><div><span>Para</span><div className="review-person"><Avatar initials={selectedContact.initials} color={selectedContact.color} size="sm" /><strong>{selectedContact.name} <small>{selectedContact.handle}</small></strong></div></div><div className="review-divider" /><div><span>{isSend ? "Desde" : "Estado"}</span><strong>{isSend ? "Banco Uno · ••••8421" : "Solicitud pendiente"}</strong></div></div>
        <div className="security-notice"><ShieldCheck size={18} /><span>{isSend ? <>Validarás con <strong>PIN + código OTP</strong> antes de registrar el envío.</> : <>Cada solicitud recibe una referencia única y un estado visible.</>}</span></div>
        {operationError && <div className="flow-error"><CircleAlert size={17} /><span>{operationError}</span></div>}
        <div className="flow-footer"><button className="back-button" onClick={() => onStepChange("recipient")}>Atrás</button><button className="primary-button" disabled={isWorking} onClick={isSend ? onBeginVerification : onConfirm}>{isSend ? "Validar envío" : "Confirmar solicitud"} <Fingerprint size={18} /></button></div>
      </div>}

      {step === "auth" && <div className="flow-body auth-body"><div className="auth-rings"><span><Fingerprint size={42} /></span></div><h3>{isWorking ? "Verificando tu identidad" : "Confirma el envío"}</h3><p>Tu PIN se comprueba con hash y el código OTP expira en cinco minutos.</p>{sandboxOtpCode && <div className="sandbox-otp"><span>CÓDIGO DEMO DEL SANDBOX</span><strong>{sandboxOtpCode}</strong><small>En producción se enviaría por un canal verificado; nunca se muestra en pantalla.</small></div>}<div className="verification-inputs"><label>PIN de 6 dígitos<input value={pinCode} onChange={(event) => onPinChange(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" /></label><label>Código OTP<input value={otpCode} onChange={(event) => onOtpChange(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" /></label></div>{operationError && <div className="flow-error"><CircleAlert size={17} /><span>{operationError}</span></div>}<div className="auth-checks"><span><Check size={15} /> Desafío {verificationChallengeId ? "creado para esta sesión" : "pendiente"}</span><span><Check size={15} /> Idempotencia y reglas de riesgo activas</span><span><ShieldCheck size={15} /> El código se consumirá una sola vez</span></div><div className="flow-footer"><button className="back-button" disabled={isWorking} onClick={() => onStepChange("review")}>Atrás</button><button className="primary-button" disabled={isWorking || pinCode.length !== 6 || otpCode.length !== 6} onClick={onConfirm}>Validar y enviar <ShieldCheck size={18} /></button></div></div>}

      {step === "success" && <div className="flow-body success-body"><div className="success-orb"><Check size={44} /></div><h3>L {formatMoney(numericAmount)} {successVerb}</h3><p>{isSend && latestStatus !== "Completado" ? "La liquidación requiere confirmación firmada del proveedor sandbox." : `a ${selectedContact.name}`}</p><div className="receipt-card"><div><span>Referencia</span><strong>{reference}</strong></div><div><span>Estado</span><StatusPill status={latestStatus} /></div><div><span>Entorno</span><strong className="sandbox-copy">Sandbox · sin dinero real</strong></div></div><button className="receipt-link"><ReceiptText size={17} /> Comprobante trazable</button><button className="primary-button full-width" onClick={onClose}>Listo</button></div>}
    </section>
  </div>;
}

function ActivityView({ transfers, onSend }: { transfers: Transfer[]; onSend: () => void }) {
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");
  const visible = filter === "all" ? transfers : transfers.filter((transfer) => transfer.type === filter);
  return <section className="view-section"><div className="page-heading"><div><div className="eyebrow"><Activity size={14} /> HISTORIAL TRAZABLE</div><h1>Actividad</h1><p>Cada movimiento conserva su referencia y su estado.</p></div><button className="primary-button" onClick={onSend}><Send size={17} /> Enviar dinero</button></div><div className="state-guide"><div><strong>Estados operativos</strong><p>Pendiente espera confirmación; Rechazado, Fallido y Expirado requieren una acción nueva.</p></div><div><StatusPill status="Pendiente" /><StatusPill status="Rechazado" /><StatusPill status="Expirado" /></div></div><div className="filter-tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todos</button><button className={filter === "in" ? "active" : ""} onClick={() => setFilter("in")}>Recibidos</button><button className={filter === "out" ? "active" : ""} onClick={() => setFilter("out")}>Enviados</button></div><div className="panel history-panel"><div className="table-header"><span>OPERACIÓN</span><span>REFERENCIA</span><span>ESTADO</span><span>MONTO</span></div>{visible.map((transfer) => <div className="history-row" key={transfer.id}><div className="history-person"><Avatar initials={transfer.icon} color={transfer.color} /><div><strong>{transfer.person}</strong><span>{transfer.type === "in" ? "Recibido" : "Enviado"} · {transfer.time}</span></div></div><code>{transfer.id}</code><StatusPill status={transfer.status} /><strong><Money value={transfer.amount} type={transfer.type} /></strong></div>)}</div></section>;
}

function AccountsView({ accounts, balance }: { accounts: { id: string; provider: string; displayName: string; lastFour: string; status: string }[]; balance: number }) {
  const visibleAccounts = accounts.length > 0 ? accounts : [{ id: "preview", provider: "SandboxBankAdapter", displayName: "Banco Uno Sandbox", lastFour: "8421", status: "linked" }];
  return <section className="view-section"><div className="page-heading"><div><div className="eyebrow"><Landmark size={14} /> FUENTES DE FONDOS</div><h1>Mis cuentas</h1><p>Conecta tus bancos sin exponer tus credenciales.</p></div><button className="secondary-button" onClick={() => toast.message("La vinculación real queda deshabilitada mientras el producto opera solo en sandbox.")}><Plus size={17} /> Vincular cuenta</button></div><div className="accounts-grid">{visibleAccounts.map((account, index) => <article className={index === 0 ? "bank-card primary-bank" : "bank-card"} key={account.id}><div className={index === 0 ? "bank-logo" : "bank-logo ficohsa"}>{account.displayName.slice(0, 1)}</div><div className="bank-card-top"><span>{index === 0 ? "CUENTA PRINCIPAL" : "CUENTA VINCULADA"}</span><StatusPill status="Completado" /></div><h2>{account.displayName}</h2><p>Cuenta simulada · ••••{account.lastFour}</p><strong>L {formatMoney(index === 0 ? balance : 0)}</strong><div className="bank-card-bottom"><span>{account.provider}</span><ChevronRight size={17} /></div></article>)}<button className="link-account" onClick={() => toast.message("Próximamente: flujo de vinculación con consentimiento y tokenización.")}><span><Plus size={20} /></span><strong>Vincular otra cuenta</strong><small>Usa un conector seguro</small></button></div><section className="provider-note"><div className="provider-icon"><LockKeyhole size={20} /></div><div><strong>Diseñada para integrar bancos reales</strong><p>La interfaz de proveedores está desacoplada. Hoy opera en sandbox; mañana puede conectar adaptadores autorizados.</p></div><ChevronRight size={19} /></section></section>;
}

function SecurityView({ securityContext, biometricsEnabled, onToggle }: { securityContext: SecurityContext; biometricsEnabled: boolean; onToggle: () => void }) {
  const utils = trpc.useUtils();
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [deviceEnrollmentChallengeId, setDeviceEnrollmentChallengeId] = useState<string | null>(null);
  const [deviceEnrollmentSandboxCode, setDeviceEnrollmentSandboxCode] = useState<string | null>(null);
  const [deviceEnrollmentPin, setDeviceEnrollmentPin] = useState("");
  const [deviceEnrollmentOtp, setDeviceEnrollmentOtp] = useState("");
  const securityQuery = trpc.security.overview.useQuery(securityContext, { retry: false });
  const setPinMutation = trpc.security.setPin.useMutation({
    onSuccess: async () => {
      setCurrentPin("");
      setNewPin("");
      await utils.security.overview.invalidate();
      toast.success(hasPin ? "PIN actualizado y sesiones anteriores revocadas." : "PIN configurado con hash para el sandbox.");
    },
    onError: (error) => toast.error(error.message),
  });
  const revokeSessionMutation = trpc.security.revokeSession.useMutation({
    onSuccess: async () => { await utils.security.overview.invalidate(); toast.success("Sesión de seguridad revocada."); },
    onError: (error) => toast.error(error.message),
  });
  const revokeOtherSessionsMutation = trpc.security.revokeOtherSessions.useMutation({
    onSuccess: async ({ revoked }) => {
      await utils.security.overview.invalidate();
      toast.success(revoked ? `${revoked} sesión${revoked === 1 ? "" : "es"} cerrada${revoked === 1 ? "" : "s"}.` : "No había otras sesiones activas.");
    },
    onError: (error) => toast.error(error.message),
  });
  const revokeDeviceMutation = trpc.security.revokeDevice.useMutation({
    onSuccess: async () => { await utils.security.overview.invalidate(); toast.success("Dispositivo de confianza revocado."); },
    onError: (error) => toast.error(error.message),
  });
  const startDeviceEnrollmentMutation = trpc.security.startDeviceEnrollment.useMutation({
    onSuccess: async (result) => {
      if (result.alreadyTrusted) {
        setDeviceEnrollmentChallengeId(null);
        setDeviceEnrollmentSandboxCode(null);
        toast.success("Este dispositivo ya es confiable.");
      } else {
        const eligibleAtMs = result.eligibleAt ? new Date(result.eligibleAt).getTime() : null;
        const coolingDown = result.coolingDown === true || (eligibleAtMs !== null && eligibleAtMs > Date.now());
        if (coolingDown) {
          // The deployed hardened API still returns an OTP during cooling. Never retain an OTP
          // that is guaranteed to expire before the device becomes eligible; request a fresh one later.
          setDeviceEnrollmentChallengeId(null);
          setDeviceEnrollmentSandboxCode(null);
          setDeviceEnrollmentOtp("");
          toast.message("El dispositivo quedó pendiente. Genera un código nuevo cuando termine el periodo de enfriamiento.");
        } else {
          if (!result.challengeId || !result.sandboxCode) throw new Error("El servidor no devolvió un desafío de enrolamiento válido");
          setDeviceEnrollmentChallengeId(result.challengeId);
          setDeviceEnrollmentSandboxCode(result.sandboxCode);
          toast.message("Código OTP generado para verificar este dispositivo.");
        }
      }
      await utils.security.overview.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const verifyDeviceEnrollmentMutation = trpc.security.verifyDeviceEnrollment.useMutation({
    onSuccess: async () => {
      setDeviceEnrollmentChallengeId(null);
      setDeviceEnrollmentSandboxCode(null);
      setDeviceEnrollmentPin("");
      setDeviceEnrollmentOtp("");
      await utils.security.overview.invalidate();
      toast.success("Dispositivo verificado y marcado como confiable.");
    },
    onError: (error) => toast.error(error.message),
  });
  const overview = securityQuery.data;
  const hasPin = Boolean(overview?.hasPin);
  const limits = overview?.transferLimits;
  const formattedDate = (value: Date | string | null) => value ? new Date(value).toLocaleString("es-HN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  const deviceCoolingDown = Boolean(overview?.currentDeviceEligibleAt && new Date(overview.currentDeviceEligibleAt).getTime() > Date.now());
  const actionLabel = (action: string) => ({
    security_pin_set: "PIN configurado",
    security_pin_rotated: "PIN actualizado",
    security_pin_rotation_rejected: "Cambio de PIN rechazado",
    transfer_otp_verified: "OTP de transferencia validado",
    security_session_revoked: "Sesión cerrada",
    security_other_sessions_revoked: "Otras sesiones cerradas",
    trusted_device_discovered: "Dispositivo registrado",
    device_enrollment_cooling_started: "Periodo de enfriamiento iniciado",
    device_enrollment_requested: "Verificación de dispositivo solicitada",
    device_trusted: "Dispositivo marcado como confiable",
    trusted_device_revoked: "Dispositivo revocado",
  }[action] || action.replaceAll("_", " "));

  return <section className="view-section">
    <div className="page-heading"><div><div className="eyebrow"><ShieldCheck size={14} /> CONTROL DE ACCESO</div><h1>Seguridad</h1><p>PIN, OTP, sesiones y dispositivos persistidos exclusivamente para el sandbox.</p></div><span className="sandbox-security-badge">SIMULADO · NO PRODUCCIÓN</span></div>
    <div className="security-grid">
      <div className="panel settings-panel">
        <div className="panel-heading"><div><span className="section-kicker">VERIFICACIÓN DE TRANSACCIONES</span><h2>Protege tus envíos</h2></div><StatusPill status={hasPin ? "Completado" : "Solicitado"} /></div>
        <div className="security-setting"><div className="setting-icon purple"><LockKeyhole size={20} /></div><div><strong>PIN de seguridad</strong><p>{hasPin ? "Para modificarlo debes validar el PIN actual. Al cambiarlo se cierran las demás sesiones de seguridad." : "Crea un PIN de seis dígitos antes de enviar dinero."}</p></div></div>
        <form className="pin-form pin-rotation-form" onSubmit={(event) => { event.preventDefault(); setPinMutation.mutate({ ...securityContext, pin: newPin, currentPin: hasPin ? currentPin : undefined }); }}>
          {hasPin && <label>PIN actual<input value={currentPin} onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="current-password" placeholder="••••••" /></label>}
          <label>{hasPin ? "Nuevo PIN" : "PIN de 6 dígitos"}<input value={newPin} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="new-password" placeholder="••••••" /></label>
          <button className="primary-button" disabled={newPin.length !== 6 || (hasPin && currentPin.length !== 6) || setPinMutation.isPending}>{hasPin ? "Actualizar PIN" : "Configurar PIN"}</button>
        </form>
        {overview?.pinLockedUntil && <div className="security-alert"><CircleAlert size={17} /><span>PIN bloqueado hasta {formattedDate(overview.pinLockedUntil)}.</span></div>}
        <div className="limit-card"><div className="limit-card-icon"><ShieldCheck size={19} /></div><div><strong>Límites preventivos del sandbox</strong><p>Máximo por envío: <b>L {formatMoney((limits?.maxSingleMinor ?? 100_000) / 100)}</b> · límite diario: <b>L {formatMoney((limits?.maxDailyMinor ?? 200_000) / 100)}</b>.</p><div className="limit-progress"><span style={{ width: `${Math.min(100, ((limits?.attemptedMinor ?? 0) / (limits?.maxDailyMinor ?? 200_000)) * 100)}%` }} /></div><small>Intentos reservados hoy (UTC): L {formatMoney((limits?.attemptedMinor ?? 0) / 100)} · Disponible: L {formatMoney((limits?.remainingMinor ?? 200_000) / 100)}</small></div></div>
        <div className="security-setting"><div className="setting-icon mint"><Fingerprint size={21} /></div><div><strong>Biometría del dispositivo</strong><p>Preferencia visual preparada para WebAuthn; LIRA no almacena datos biométricos.</p></div><button role="switch" aria-checked={biometricsEnabled} className={biometricsEnabled ? "toggle on" : "toggle"} onClick={() => { onToggle(); toast.message("Preferencia local actualizada; WebAuthn no está implementado en este sandbox."); }}><span /></button></div>
        <div className="security-setting"><div className="setting-icon amber"><ShieldCheck size={20} /></div><div><strong>Verificación por código OTP</strong><p>Cada envío usa un desafío de una sola vez, vinculado a esta sesión y válido durante cinco minutos.</p></div><span className="status-pill status-progress"><Clock3 size={13} /> Activa</span></div>
        <div className="immutable-log"><LockKeyhole size={16} /><span>El OTP se muestra solo en la demostración. Un canal de entrega verificado, recuperación de cuenta y MFA real permanecen fuera de alcance.</span></div>
      </div>
      <div className="panel devices-panel">
        <div className="panel-heading"><div><span className="section-kicker">ACCESO VIGENTE</span><h2>Dispositivos y sesiones</h2></div><button className="link-button" onClick={() => securityQuery.refetch()}><RefreshCw size={15} /> Actualizar</button></div>
        {securityQuery.isLoading ? <div className="security-loading"><RefreshCw className="spin" size={18} /> Cargando controles…</div> : <>
          <div className="device-group-title">DISPOSITIVOS DE CONFIANZA</div>
          {overview?.devices.map((device) => <div className="device-item" key={device.id}><div className="device-icon"><Smartphone size={21} /></div><div><strong>{device.id === overview.currentDeviceId ? "Este navegador" : device.label}</strong><p>{device.platform} · visto {formattedDate(device.lastUsedAt)}</p></div>{device.revokedAt || device.status === "revoked" ? <span className="status-pill status-alert">Revocado</span> : device.status === "trusted" ? <span className="status-pill status-complete">Confiable</span> : device.status === "pending" ? <span className="status-pill status-progress">Pendiente</span> : device.status === "restricted" ? <span className="status-pill status-alert">Restringido</span> : <span className="status-pill status-request">Nuevo</span>}{!device.revokedAt && device.id !== overview.currentDeviceId && <button className="text-button danger-text" disabled={revokeDeviceMutation.isPending} onClick={() => revokeDeviceMutation.mutate({ deviceId: device.id })}>Revocar</button>}</div>)}
          {!overview?.devices.length && <div className="empty-security">Sin dispositivos registrados todavía.</div>}
          {overview?.currentDeviceStatus !== "trusted" && <div className="security-alert">
            <ShieldCheck size={17} />
            <div>
              <strong>Este dispositivo todavía no puede autorizar transferencias.</strong>
              <p>Un identificador del navegador solo registra el dispositivo; no lo convierte automáticamente en confiable. Configura tu PIN, solicita la verificación y completa el periodo de enfriamiento antes de activarlo.</p>
              {overview?.currentDeviceEligibleAt && <small>Elegible a partir de {formattedDate(overview.currentDeviceEligibleAt)}.</small>}
              <div className="verification-inputs">
                <label>PIN<input value={deviceEnrollmentPin} onChange={(event) => setDeviceEnrollmentPin(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="current-password" placeholder="••••••" /></label>
                {deviceEnrollmentChallengeId && <label>Código OTP<input value={deviceEnrollmentOtp} onChange={(event) => setDeviceEnrollmentOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" /></label>}
              </div>
              {deviceEnrollmentSandboxCode && <div className="sandbox-otp"><span>CÓDIGO DEMO DEL SANDBOX</span><strong>{deviceEnrollmentSandboxCode}</strong><small>Solo se muestra en este entorno de demostración.</small></div>}
              <div className="flow-footer">
                {!deviceEnrollmentChallengeId
                  ? <button className="secondary-button" disabled={!hasPin || startDeviceEnrollmentMutation.isPending || (overview?.currentDeviceStatus === "pending" && deviceCoolingDown)} onClick={() => startDeviceEnrollmentMutation.mutate(securityContext)}>{overview?.currentDeviceStatus === "pending" ? (deviceCoolingDown ? "En periodo de enfriamiento" : "Generar código OTP") : "Solicitar verificación"}</button>
                  : <button className="primary-button" disabled={deviceEnrollmentPin.length !== 6 || deviceEnrollmentOtp.length !== 6 || verifyDeviceEnrollmentMutation.isPending} onClick={() => verifyDeviceEnrollmentMutation.mutate({ ...securityContext, challengeId: deviceEnrollmentChallengeId, pin: deviceEnrollmentPin, code: deviceEnrollmentOtp })}>Verificar dispositivo</button>}
              </div>
              {!hasPin && <small>Primero crea tu PIN de seis dígitos en el panel de la izquierda.</small>}
              {hasPin && overview?.currentDeviceStatus === "pending" && deviceCoolingDown && <small>Cuando llegue la hora indicada, pulsa Actualizar y luego genera un código OTP nuevo. No se emiten códigos que vayan a expirar durante la espera.</small>}
            </div>
          </div>}
          {overview?.currentDeviceStatus === "trusted" && <div className="security-alert subtle-alert"><CheckCircle2 size={17} /><span>Este dispositivo está marcado como confiable y puede iniciar verificaciones de transferencia.</span></div>}
          <div className="session-heading"><span className="device-group-title">SESIONES DE SEGURIDAD</span>{(overview?.activeSessionCount ?? 0) > 1 && <button className="text-button danger-text" disabled={revokeOtherSessionsMutation.isPending} onClick={() => revokeOtherSessionsMutation.mutate(securityContext)}>Cerrar las demás</button>}</div>
          {overview?.sessions.map((session) => <div className="device-item session-item" key={session.id}><div className="device-icon"><LayoutDashboard size={20} /></div><div><strong>{session.id === overview.currentSessionId ? "Sesión actual" : session.label}</strong><p>Última actividad {formattedDate(session.lastSeenAt)}</p></div>{session.revokedAt ? <span className="status-pill status-alert">Cerrada</span> : session.id === overview.currentSessionId ? <span className="status-pill status-complete">Actual</span> : <button className="text-button danger-text" disabled={revokeSessionMutation.isPending} onClick={() => revokeSessionMutation.mutate({ sessionId: session.id })}>Cerrar</button>}</div>)}
          <div className="security-alert subtle-alert"><ShieldCheck size={17} /><span>Estas acciones revocan el acceso al flujo OTP del sandbox, no la sesión principal de Manus.</span></div>
          <div className="device-group-title audit-title">BITÁCORA RECIENTE</div>
          <div className="security-audit-list">{overview?.recentSecurityEvents.map((event) => <div className="security-audit-row" key={event.id}><span><Check size={14} /></span><div><strong>{actionLabel(event.action)}</strong><small>{formattedDate(event.createdAt)} · {event.resource}</small></div></div>)}{!overview?.recentSecurityEvents.length && <div className="empty-security">La actividad de seguridad aparecerá aquí.</div>}</div>
        </>}
      </div>
    </div>
  </section>;
}
function AdminView() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const isAdmin = user?.role === "admin";
  const overviewQuery = trpc.financeAdmin.overview.useQuery(undefined, { enabled: isAdmin, retry: false });
  const controlMutation = trpc.financeAdmin.setTransferControl.useMutation({
    onSuccess: async () => {
      await utils.financeAdmin.overview.invalidate();
      toast.success("Control operativo actualizado y auditado.");
    },
    onError: (error) => toast.error(error.message),
  });

  if (!isAdmin) {
    return <section className="view-section"><div className="page-heading"><div><div className="eyebrow"><LayoutDashboard size={14} /> ACCESO RESTRINGIDO</div><h1>Centro de control</h1><p>Esta consola requiere un rol administrativo otorgado en el servidor.</p></div></div><div className="panel empty-admin"><LockKeyhole size={28} /><h2>Sin permisos administrativos</h2><p>El acceso a riesgo, conciliación y controles operativos nunca depende solo de la interfaz.</p></div></section>;
  }

  const overview = overviewQuery.data;
  const total = overview?.recentTransfers.length ?? 0;
  const settled = overview?.recentTransfers.filter((transfer) => transfer.status === "settled").length ?? 0;
  const successRate = total ? Math.round((settled / total) * 100) : 0;
  const openRisk = overview?.risks.filter((risk) => risk.decision === "review" || risk.decision === "block").length ?? 0;
  const lastRecon = overview?.reconciliations[0];
  const transfersEnabled = overview?.controls.find((control) => control.control === "transfers_enabled")?.enabled !== 0;
  const riskClass = (decision: string) => decision === "block" ? "block" : decision === "review" ? "review" : "allow";

  return <section className="view-section admin-view"><div className="page-heading"><div><div className="eyebrow"><LayoutDashboard size={14} /> ADMINISTRACIÓN · ENTORNO SANDBOX</div><h1>Centro de control</h1><p>Datos operativos persistidos. Los saldos no son editables desde esta consola.</p></div><button className="secondary-button" onClick={() => toast.message("La exportación de evidencia se agregará junto con el paquete de due diligence.")}><ReceiptText size={17} /> Exportar reporte</button></div>{overviewQuery.isLoading ? <div className="panel loading-panel"><RefreshCw className="spin" size={20} /> Cargando datos operativos…</div> : <><div className="admin-kpis"><div className="kpi-card"><span>Transferencias registradas</span><strong>{total}</strong><small><Activity size={14} /> Datos del sandbox</small></div><div className="kpi-card"><span>Operaciones liquidadas</span><strong>{successRate}%</strong><small className="success-copy"><CheckCircle2 size={14} /> {settled} con ledger</small></div><div className="kpi-card"><span>Cola de riesgo</span><strong>{String(openRisk).padStart(2, "0")}</strong><small className={openRisk ? "warning-copy" : "success-copy"}>{openRisk ? <CircleAlert size={14} /> : <CheckCircle2 size={14} />}{openRisk ? " Requieren revisión" : " Sin bloqueos abiertos"}</small></div><div className="kpi-card"><span>Conciliación reciente</span><strong>{lastRecon?.status?.toUpperCase() || "—"}</strong><small className={lastRecon?.status === "match" ? "success-copy" : "warning-copy"}>{lastRecon?.status === "match" ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}{lastRecon ? " Ledger · proveedor" : " Aún sin registros"}</small></div></div><div className="admin-grid"><div className="panel risk-panel"><div className="panel-heading"><div><span className="section-kicker">COLA DE RIESGO</span><h2>Eventos recientes</h2></div><span className="status-pill status-request">policy sandbox-v1</span></div>{overview?.risks.length ? overview.risks.slice(0, 4).map((risk) => <div className="risk-event" key={risk.id}><span className={`risk-indicator ${riskClass(risk.decision)}`} /><div><strong>{risk.rule.replaceAll("_", " ")}</strong><p>{risk.transferId.slice(0, 12)} · score {risk.score}</p></div><span className={`risk-badge ${riskClass(risk.decision)}`}>{risk.decision.toUpperCase()}</span></div>) : <div className="empty-risk">Las decisiones de riesgo aparecerán aquí al procesar operaciones.</div>}</div><div className="panel reconciliation-panel"><div className="panel-heading"><div><span className="section-kicker">INTEGRIDAD CONTABLE</span><h2>Última conciliación</h2></div><StatusPill status={lastRecon?.status === "match" ? "Completado" : "Pendiente"} /></div><div className="recon-visual"><div><span className="recon-icon"><Banknote size={20} /></span><strong>Ledger LIRA</strong><small>{lastRecon ? `L ${formatMoney(lastRecon.expectedAmountMinor / 100)}` : "Sin movimiento"}</small></div><div className="recon-link"><span /><CheckCircle2 size={25} /><span /></div><div><span className="recon-icon provider"><Landmark size={20} /></span><strong>Proveedor</strong><small>{lastRecon ? `${lastRecon.provider}` : "SandboxBankAdapter"}</small></div></div><div className={lastRecon?.status === "match" ? "recon-match" : "recon-pending"}>{lastRecon?.status === "match" ? <><Check size={15} /> Débitos = créditos · Datos consistentes</> : <><Clock3 size={15} /> Sin evidencia de conciliación todavía</>}</div></div></div><section className="control-strip"><div><span className="section-kicker">KILL SWITCH OPERATIVO</span><strong>{transfersEnabled ? "Nuevas transferencias habilitadas" : "Nuevas transferencias pausadas"}</strong><p>La lectura de historial, auditoría y conciliación permanecen disponibles.</p></div><button className={transfersEnabled ? "pause-button" : "primary-button"} disabled={controlMutation.isPending} onClick={() => controlMutation.mutate({ enabled: !transfersEnabled, reason: transfersEnabled ? "Pausa preventiva desde la consola sandbox" : "Reanudación controlada desde la consola sandbox" })}>{transfersEnabled ? "Pausar transferencias" : "Reanudar transferencias"}</button></section></>}<div className="admin-footnote"><ShieldCheck size={18} /><span><strong>Invariante activo:</strong> toda transferencia liquidada del sandbox se publica con un débito, un crédito, una referencia y una traza de auditoría.</span></div></section>;
}
