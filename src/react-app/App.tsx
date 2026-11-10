import {
	startAuthentication,
	startRegistration,
} from "@simplewebauthn/browser";
import bcrypt from "bcryptjs";
import type {
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import {
	BarChart3,
	ClipboardList,
	ChevronDown,
	History,
	LayoutGrid,
	LogOut,
	Play,
	PlusCircle,
	Settings,
	SlidersHorizontal,
	Trophy,
	Users,
} from "lucide-react";
import { createContext, type FormEvent, type MouseEvent, useContext, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { normalisePathname, routeFor, sessionIdFor } from "./routing";

type HealthStatus = "checking" | "ready" | "unavailable";
type ActionStatus = "idle" | "submitting" | "complete" | "error";
type AuthStatus = "checking" | "anonymous" | "authenticated";
type RealtimeStatus = "idle" | "connecting" | "connected" | "reconnecting";
type RankingPeriod = "all" | "year" | "month";
type RankingMetric = "total" | "average" | "topRate";

interface User { id: string; userId: string; displayName: string; avatarUpdatedAtMs?: number | null; }
interface SessionSummary { id: string; name: string | null; joinCode: string; playerCount: 3 | 4; memberCount: number; status: "open" | "active" | "closed"; }
interface SessionMember { id: string; userId: string; displayName: string; seatIndex: number | null; avatarUpdatedAtMs: number | null; }
interface GameResultSummary { userId: string; displayName: string; finalScore: number; rank: number; pointsMilli: number; }
interface GameSummary { id: string; ordinal: number; recordedAtMs: number; results: GameResultSummary[]; }
interface GameDraftEntry { userId: string; finalScore: number; rank: number | null; }
interface SessionDetail extends SessionSummary { ownerUserId: string; stateVersion: number; rules: { baseScore: number }; members: SessionMember[]; games: GameSummary[]; }
interface SessionHistoryItem { id: string; name: string | null; playerCount: 3 | 4; closedAtMs: number; totalPointsMilli: number; rank: number | null; gameCount: number; members: SessionMember[]; }
interface RankingPlayer { id: string; userId: string; displayName: string; gamesPlayed: number; totalPointsMilli: number; averagePointsMilli: number; topFinishes: number; topRateBasisPoints: number; avatarUpdatedAtMs: number | null; }
interface FriendSummary { id: string; userId: string; displayName: string; avatarUpdatedAtMs: number | null; totalPointsMilli: number; }
interface FriendRequest { id: string; createdAtMs: number; user: Pick<FriendSummary, "id" | "userId" | "displayName" | "avatarUpdatedAtMs">; }
interface PlayerStats { period: RankingPeriod; summary: { totalGames: number; totalSessions: number; totalPointsMilli: number; averagePointsMilli: number | null; averageRank: number | null; topRateBasisPoints: number | null; topTwoRateBasisPoints: number | null; lastRateBasisPoints: number | null; }; rankCounts: Record<number, number>; recentGames: { id: string; ordinal: number; playedAtMs: number; sessionName: string | null; playerCount: 3 | 4; rank: number; finalScore: number; pointsMilli: number; }[]; trend: { playedAtMs: number; cumulativePointsMilli: number; rank: number; pointsMilli: number }[]; }
interface RegistrationOptionsResponse { challengeId: string; options: PublicKeyCredentialCreationOptionsJSON; }
interface LoginOptionsResponse { challengeId: string; options: PublicKeyCredentialRequestOptionsJSON; }
interface PasswordLoginOptionsResponse { challengeId: string; challenge: string; salt: string; }
interface ConfirmationRequest { title: string; description: string; confirmLabel: string; action: () => void | Promise<void>; }

const API_ERROR_MESSAGES: Record<string, string> = {
	cross_site_request: "安全確認に失敗しました。ページを再読み込みして、もう一度お試しください。",
	unauthenticated: "ログインの有効期限が切れました。もう一度ログインしてください。",
	invalid_registration_input: "ユーザーIDが使用済みか、入力形式が正しくありません。英数字・_・-の3〜32文字で入力してください。",
	invalid_user_id: "ユーザーIDは英数字・_・-の3〜32文字で入力してください。",
	user_id_taken: "そのユーザーIDは既に使われています。別のユーザーIDを入力してください。",
	invalid_display_name: "表示名は1〜80文字で入力してください。",
	invalid_registration_response: "パスキーを確認できませんでした。端末の認証を完了して、もう一度お試しください。",
	registration_unavailable: "現在パスキーを登録できません。通信状態を確認して、しばらくしてからお試しください。",
	invalid_login: "認証情報を確認できませんでした。入力内容を確認して、もう一度お試しください。",
	login_unavailable: "現在ログイン処理を利用できません。通信状態を確認して、しばらくしてからお試しください。",
	migration_not_available: "このアカウントは移行済みか、移行対象ではありません。パスキーでログインしてください。",
	invalid_migration_response: "パスキー登録を確認できませんでした。旧メールアドレスとパスワードは削除されていません。",
	migration_unavailable: "現在パスキー移行を完了できません。旧認証情報は削除されていません。しばらくしてからお試しください。",
	account_deletion_unavailable: "アカウントを削除できませんでした。時間をおいて、もう一度お試しください。",
	user_id_immutable: "ユーザーIDは変更できません。",
	unsupported_type: "PNGまたはWebP形式の画像を選択してください。",
	empty_file: "画像ファイルが空です。別の画像を選択してください。",
	file_too_large: "画像は256KiB以下にしてください。",
	invalid_image: "画像データを読み取れませんでした。別のPNGまたはWebP画像を選択してください。",
	user_not_found: "入力したユーザーIDの利用者は見つかりませんでした。",
	cannot_friend_self: "自分自身にはフレンド申請を送れません。",
	already_friends: "この利用者とは既にフレンドです。",
	request_exists: "この利用者へのフレンド申請は既に送信済みです。",
	request_not_found: "フレンド申請が見つかりません。既に処理された可能性があります。",
	friend_not_found: "フレンド情報が見つかりません。",
	invalid_session_input: "セッションの設定に誤りがあります。人数、基準点、係数、順位ボーナスを確認してください。",
	cannot_join_session: "参加コードが正しくない、満員、または終了済みのセッションです。",
	session_not_found: "セッションが見つからないか、参加権限がありません。",
	not_a_member: "このセッションの参加者ではないため操作できません。",
	not_session_owner: "セッションを終了できるのは作成者だけです。",
	session_closed: "このセッションは終了済みのため変更できません。",
	invalid_score: "持ち点は整数で入力してください。",
	session_not_ready: "全員の入力が揃っていません。参加人数と入力状況を確認してください。",
	invalid_rules: "セッションのルール設定が正しくないため結果を確定できません。",
	invalid_scores: "持ち点の合計または順位が正しくありません。全員の入力を確認してください。",
	idempotency_conflict: "同じ確定操作が異なる内容で送信されました。画面を再読み込みしてください。",
	invalid_game_input: "結果確定に必要な情報が不足しています。画面を再読み込みしてください。",
	use_game_draft: "入力方法が更新されています。画面を再読み込みしてください。",
};

async function apiError(response: Response, fallback: string): Promise<Error> {
	let code = "";
	try {
		const body = (await response.clone().json()) as { error?: unknown };
		if (typeof body.error === "string") code = body.error;
	} catch {
		// Some gateway failures do not return JSON.
	}
	const message = API_ERROR_MESSAGES[code]
		|| (response.status === 429 ? "操作が多すぎます。少し待ってからもう一度お試しください。" : "");
	return new Error(message || fallback);
}

function errorMessage(error: unknown, fallback: string): string {
	if (error instanceof DOMException) {
		if (error.name === "NotAllowedError") return "端末での認証がキャンセルされたか、時間切れになりました。もう一度お試しください。";
		if (error.name === "InvalidStateError") return "この端末には同じパスキーが既に登録されています。別の認証方法を選択してください。";
		if (error.name === "AbortError") return "操作が中断されました。もう一度お試しください。";
	}
	if (error instanceof TypeError) return "サーバーに接続できませんでした。通信状態を確認して、もう一度お試しください。";
	return error instanceof Error && error.message ? error.message : fallback;
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createPasswordProof(password: string, salt: string, challenge: string): Promise<string> {
	const passwordHash = await bcrypt.hash(password, salt);
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(passwordHash),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(challenge))));
}

const AvatarDetailContext = createContext<(userId: string) => void>(() => undefined);

function UserAvatar({ userId, displayName, updatedAtMs, size = "medium", interactive = true }: { userId: string; displayName: string; updatedAtMs?: number | null; size?: "small" | "medium" | "large"; interactive?: boolean }) {
	const openDetail = useContext(AvatarDetailContext);
	return <span className={`user-avatar ${size} ${interactive ? "avatar-interactive" : ""}`} role={interactive ? "button" : undefined} tabIndex={interactive ? 0 : undefined} aria-label={interactive ? `${displayName}の詳細を開く` : undefined} onClick={interactive ? (event) => { event.preventDefault(); event.stopPropagation(); openDetail(userId); } : undefined} onKeyDown={interactive ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); openDetail(userId); } } : undefined}><span>{displayName.trim().slice(0, 2).toUpperCase()}</span>{updatedAtMs != null && <img alt={displayName} src={`/api/users/${encodeURIComponent(userId)}/avatar?v=${updatedAtMs}`} onError={(event) => { event.currentTarget.hidden = true; }} />}</span>;
}

function UserDetailName({ userId, displayName }: { userId: string; displayName: string }) {
	const openDetail = useContext(AvatarDetailContext);
	return <button className="user-detail-name" type="button" onClick={() => openDetail(userId)}>{displayName}</button>;
}

function ScoreEntryCard({ session, currentUserId, entries, score, rank, status, onScoreChange, onRankChange, onSubmit, onConfirm }: {
	session: SessionDetail; currentUserId: string | undefined; entries: GameDraftEntry[]; score: string; rank: string; status: ActionStatus;
	onScoreChange: (value: string) => void; onRankChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onConfirm: () => void;
}) {
	const ownEntry = entries.find((entry) => entry.userId === currentUserId);
	const allSubmitted = session.members.length === session.playerCount && entries.length === session.playerCount;
	const total = entries.reduce((sum, entry) => sum + entry.finalScore, 0);
	const difference = total - session.rules.baseScore * session.playerCount;
	return <section className="card score-entry-card"><header><h3>半荘結果を入力</h3><p>各自が自分の最終持ち点を入力し、ホストが全員分を確認して確定します。{entries.length > 0 && <span className="score-submitted-count">現在 {entries.length}/{session.playerCount} 人が入力済み</span>}</p></header><div className="score-entry-content"><div><h4>自分のスコア</h4><form className="score-form" onSubmit={onSubmit}><div className="score-self-fields"><label>最終持ち点<input inputMode="numeric" type="number" step="100" required value={score} onChange={(event) => onScoreChange(event.target.value)} /></label><label>最終順位（任意）<select value={rank} onChange={(event) => onRankChange(event.target.value)}><option value="">自動判定</option>{Array.from({ length: session.playerCount }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}位</option>)}</select></label></div><div className="score-entry-actions"><button disabled={status === "submitting"} type="submit">{ownEntry ? "変更する" : "送信する"}</button>{session.ownerUserId === currentUserId && entries.length > 0 && <button className="button-outline score-confirm-button" disabled={status === "submitting" || !allSubmitted || difference !== 0} type="button" onClick={onConfirm}>全員分を確定する</button>}</div>{session.ownerUserId === currentUserId && entries.length > 0 && !allSubmitted && <p className="hint">全員の入力が揃うまで確定できません。</p>}</form></div><div><h4>入力状況</h4><div className="score-status-grid">{session.members.map((member) => { const entry = entries.find((item) => item.userId === member.id); return <div className={`score-status-item ${entry ? "submitted" : ""}`} key={member.id}><div><span><UserAvatar userId={member.id} displayName={member.displayName} updatedAtMs={member.avatarUpdatedAtMs} size="small" /><UserDetailName userId={member.id} displayName={member.displayName} />{member.id === currentUserId && <small>（自分）</small>}</span><small>{entry ? `${entry.finalScore.toLocaleString()} 点` : "未入力"}</small></div>{entry?.rank && <b>{entry.rank}位</b>}</div>; })}</div>{allSubmitted && difference !== 0 && <p className="score-total-warning">現在 {difference > 0 ? "+" : "-"}{Math.abs(difference).toLocaleString()} 点。入力を修正してください。</p>}</div></div></section>;
}

function StatsChart({ trend, mode }: { trend: PlayerStats["trend"]; mode: "rank" | "points" | "cumulative" }) {
	if (trend.length === 0) return <p className="chart-empty">該当する戦績がありません。</p>;
	const values = trend.map((game) => mode === "rank" ? game.rank : mode === "points" ? game.pointsMilli / 1000 : game.cumulativePointsMilli / 1000);
	const min = mode === "rank" ? 1 : Math.min(0, ...values);
	const max = mode === "rank" ? 4 : Math.max(0, ...values);
	const range = Math.max(max - min, 1);
	const left = 54; const right = 12; const top = 14; const bottom = 30; const width = 640; const height = 220;
	const xFor = (index: number) => left + (values.length === 1 ? (width - left - right) / 2 : (index / (values.length - 1)) * (width - left - right));
	const yFor = (value: number) => top + ((mode === "rank" ? value - min : max - value) / range) * (height - top - bottom);
	const points = values.map((value, index) => `${xFor(index)},${yFor(value)}`).join(" ");
	const ticks = mode === "rank" ? [1, 2, 3, 4] : Array.from({ length: 4 }, (_, index) => min + ((max - min) * index) / 3).reverse();
	return <svg viewBox={`0 0 ${width} ${height}`} className="stats-chart" role="img" aria-label={mode === "rank" ? "直近の順位推移" : mode === "points" ? "直近のポイント推移" : "累計ポイント推移"}>{ticks.map((tick) => <g key={tick}><line x1={left} x2={width - right} y1={yFor(tick)} y2={yFor(tick)} /><text x={left - 8} y={yFor(tick) + 4} textAnchor="end">{mode === "rank" ? `${tick}位` : Math.round(tick).toLocaleString()}</text></g>)}<line className="chart-axis" x1={left} x2={left} y1={top} y2={height - bottom} /><line className="chart-axis" x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} /><polyline points={points} /><>{values.map((value, index) => <circle key={`${trend[index].playedAtMs}-${index}`} cx={xFor(index)} cy={yFor(value)} r="3.5"><title>{`${index + 1}戦目: ${mode === "rank" ? `${trend[index].rank}位` : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} pt`}`}</title></circle>)}</></svg>;
}

function App() {
	const [healthStatus, setHealthStatus] = useState<HealthStatus>("checking");
	const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
	const [currentUser, setCurrentUser] = useState<User | null>(null);
	const [pathname, setPathname] = useState(() => normalisePathname(window.location.pathname));
	useEffect(() => { friendDialogRef.current?.close(); }, [pathname]);
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null);
	const [history, setHistory] = useState<SessionHistoryItem[]>([]);
	const [historyStatus, setHistoryStatus] = useState<ActionStatus>("idle");
	const [historyMessage, setHistoryMessage] = useState("");
	const [historyPeriod, setHistoryPeriod] = useState<"all" | "year" | "month">("all");
	const [historyPlayerCount, setHistoryPlayerCount] = useState<"all" | "3" | "4">("all");
	const [historyQuery, setHistoryQuery] = useState("");
	const [historyOpponent, setHistoryOpponent] = useState("");
	const [historyPageSize, setHistoryPageSize] = useState<"10" | "50" | "100">("10");
	const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("idle");
	const [rankingPeriod, setRankingPeriod] = useState<RankingPeriod>("all");
	const [rankingMetric, setRankingMetric] = useState<RankingMetric>("total");
	const [rankings, setRankings] = useState<RankingPlayer[]>([]);
	const [rankingStatus, setRankingStatus] = useState<ActionStatus>("idle");
	const [rankingMessage, setRankingMessage] = useState("");
	const [friends, setFriends] = useState<FriendSummary[]>([]);
	const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
	const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
	const [friendUserId, setFriendUserId] = useState("");
	const [friendStatus, setFriendStatus] = useState<ActionStatus>("idle");
	const [friendMessage, setFriendMessage] = useState("");
	const [selectedFriend, setSelectedFriend] = useState<FriendSummary | null>(null);
	const [friendDetailStats, setFriendDetailStats] = useState<PlayerStats | null>(null);
	const [friendDetailStatus, setFriendDetailStatus] = useState<ActionStatus>("idle");
	const [friendDetailMessage, setFriendDetailMessage] = useState("");
	const [userRelation, setUserRelation] = useState<"self" | "friend" | "pending_outgoing" | "pending_incoming" | "none">("none");
	const friendDialogRef = useRef<HTMLDialogElement>(null);
	const [statsPeriod, setStatsPeriod] = useState<RankingPeriod>("all");
	const [stats, setStats] = useState<PlayerStats | null>(null);
	const [statsStatus, setStatsStatus] = useState<ActionStatus>("idle");
	const [statsMessage, setStatsMessage] = useState("");
	const [statsChartMode, setStatsChartMode] = useState<"rank" | "points" | "cumulative">("rank");
	const [avatarFile, setAvatarFile] = useState<File | null>(null);
	const [avatarStatus, setAvatarStatus] = useState<ActionStatus>("idle");
	const [avatarMessage, setAvatarMessage] = useState("");
	const [profileDisplayName, setProfileDisplayName] = useState("");
	const [profileStatus, setProfileStatus] = useState<ActionStatus>("idle");
	const [profileMessage, setProfileMessage] = useState("");
	const [pageRestoreVersion, setPageRestoreVersion] = useState(0);
	const [userId, setUserId] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [registrationStatus, setRegistrationStatus] = useState<ActionStatus>("idle");
	const [registrationMessage, setRegistrationMessage] = useState("");
	const [loginStatus, setLoginStatus] = useState<ActionStatus>("idle");
	const [loginMessage, setLoginMessage] = useState("");
	const [passwordUserId, setPasswordUserId] = useState("");
	const [password, setPassword] = useState("");
	const [passkeyMigrationRequired, setPasskeyMigrationRequired] = useState<boolean | null>(null);
	const [passkeyMigrationStatus, setPasskeyMigrationStatus] = useState<ActionStatus>("idle");
	const [passkeyMigrationMessage, setPasskeyMigrationMessage] = useState("");
	const [migrationUserId, setMigrationUserId] = useState("");
	const [sessionName, setSessionName] = useState("");
	const [playerCount, setPlayerCount] = useState<3 | 4>(4);
	const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
	const [ruleBaseScore, setRuleBaseScore] = useState(25000);
	const [ruleMultiplier, setRuleMultiplier] = useState(0.1);
	const [ruleBonuses, setRuleBonuses] = useState<Record<number, number>>({ 1: 2000, 2: 1000, 3: 0, 4: -3000 });
	const friendSelectorRef = useRef<HTMLDialogElement>(null);
	const [joinCode, setJoinCode] = useState("");
	const [sessionStatus, setSessionStatus] = useState<ActionStatus>("idle");
	const [sessionMessage, setSessionMessage] = useState("");
	const [gameScores, setGameScores] = useState<Record<string, string>>({});
	const [gameRank, setGameRank] = useState("");
	const [draftEntries, setDraftEntries] = useState<GameDraftEntry[]>([]);
	const [gameStatus, setGameStatus] = useState<ActionStatus>("idle");
	const [gameMessage, setGameMessage] = useState("");
	const [isUserMenuOpen, setUserMenuOpen] = useState(false);
	const userMenuRef = useRef<HTMLDetailsElement>(null);
	const confirmDialogRef = useRef<HTMLDialogElement>(null);
	const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
	const [confirmationPending, setConfirmationPending] = useState(false);

	const route = routeFor(pathname);
	const currentSession = sessions.find((session) => session.status !== "closed");

	function navigate(path: string) {
		const nextPath = normalisePathname(path);
		if (nextPath === pathname) return;
		window.history.pushState({}, "", nextPath);
		setUserMenuOpen(false);
		setConfirmation(null);
		setSessionStatus("idle");
		setSessionMessage("");
		setPathname(nextPath);
		window.scrollTo({ top: 0, behavior: "auto" });
	}

	function lockToPasskeyMigration() {
		const path = "/settings/passkey-migration";
		window.history.replaceState({}, "", path);
		setUserMenuOpen(false);
		setPathname(path);
		window.scrollTo({ top: 0, behavior: "auto" });
	}

	function followLink(event: MouseEvent<HTMLAnchorElement>, path: string) {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		navigate(path);
	}

	async function loadSessions() {
		const response = await fetch("/api/sessions");
		if (!response.ok) throw await apiError(response, "対局一覧を取得できませんでした。通信状態を確認してください。");
		const data = (await response.json()) as { sessions: SessionSummary[] };
		setSessions(data.sessions);
	}

	async function loadSessionDetail(sessionId: string) {
		setGameStatus("idle");
		setGameMessage("");
		const response = await fetch(`/api/sessions/${sessionId}`);
		if (!response.ok) throw await apiError(response, "対局詳細を取得できませんでした。画面を再読み込みしてください。");
		const data = (await response.json()) as { session: SessionDetail };
		setSelectedSession(data.session);
		if (data.session.status !== "closed") {
			const draftResponse = await fetch(`/api/sessions/${sessionId}/draft`, { cache: "no-store" });
			if (!draftResponse.ok) throw await apiError(draftResponse, "入力状況を取得できませんでした。画面を再読み込みしてください。");
			const draft = (await draftResponse.json()) as { entries: GameDraftEntry[] };
			setDraftEntries(draft.entries);
			const mine = draft.entries.find((entry) => entry.userId === currentUser?.id);
			setGameScores(mine && currentUser ? { [currentUser.id]: String(mine.finalScore) } : {});
			setGameRank(mine?.rank ? String(mine.rank) : "");
		} else setDraftEntries([]);
	}

	async function loadHistory() {
		setHistoryStatus("submitting");
		setHistoryMessage("");
		try {
			const response = await fetch("/api/history", {
				cache: "no-store",
				headers: { Accept: "application/json" },
			});
			if (!response.ok) throw await apiError(response, "セッション履歴を取得できませんでした。通信状態を確認して再試行してください。");
			if (!response.headers.get("content-type")?.includes("application/json")) {
				throw new Error("履歴APIから正しい応答を取得できませんでした。");
			}
			const data = (await response.json()) as { sessions: SessionHistoryItem[] };
			if (!Array.isArray(data.sessions)) throw new Error("履歴データの形式が正しくありません。");
			setHistory(data.sessions);
			setHistoryStatus("complete");
		} catch (error) {
			setHistoryStatus("error");
			setHistoryMessage(errorMessage(error, "セッション履歴を取得できませんでした。"));
		}
	}

	async function loadRankings(period: RankingPeriod) {
		setRankingStatus("submitting");
		setRankingMessage("");
		try {
			const response = await fetch(`/api/rankings?period=${period}`, {
				cache: "no-store",
				headers: { Accept: "application/json" },
			});
			if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
				throw await apiError(response, "ランキングを取得できませんでした。通信状態を確認して再試行してください。");
			}
			const data = (await response.json()) as { rankings: RankingPlayer[] };
			if (!Array.isArray(data.rankings)) throw new Error("ランキングデータの形式が正しくありません。");
			setRankings(data.rankings);
			setRankingStatus("complete");
		} catch (error) {
			setRankingStatus("error");
			setRankingMessage(errorMessage(error, "ランキングを取得できませんでした。"));
		}
	}

	async function loadFriends() {
		setFriendStatus("submitting"); setFriendMessage("");
		try {
			const response = await fetch("/api/friends", { cache: "no-store", headers: { Accept: "application/json" } });
			if (!response.ok) throw await apiError(response, "フレンド一覧を取得できませんでした。通信状態を確認して再試行してください。");
			const data = (await response.json()) as { friends: FriendSummary[]; incoming: FriendRequest[]; outgoing: FriendRequest[] };
			setFriends(data.friends); setIncomingRequests(data.incoming); setOutgoingRequests(data.outgoing); setFriendStatus("complete");
		} catch (error) { setFriendStatus("error"); setFriendMessage(errorMessage(error, "フレンド一覧を取得できませんでした。")); }
	}

	async function openUserDetail(userId: string, initial?: FriendSummary) {
		setSelectedFriend(initial ?? null);
		setFriendDetailStats(null);
		setFriendDetailStatus("submitting");
		setFriendDetailMessage("");
		if (!friendDialogRef.current?.open) friendDialogRef.current?.showModal();
		try {
			const response = await fetch(`/api/users/${encodeURIComponent(userId)}/detail`, { cache: "no-store", headers: { Accept: "application/json" } });
			if (!response.ok) throw await apiError(response, "ユーザー詳細を取得できませんでした。削除された利用者の可能性があります。");
			const data = (await response.json()) as { user: FriendSummary; relation: typeof userRelation; stats: PlayerStats };
			setSelectedFriend(data.user);
			setUserRelation(data.relation);
			setFriendDetailStats(data.stats);
			setFriendDetailStatus("complete");
		} catch (error) { setFriendDetailStatus("error"); setFriendDetailMessage(errorMessage(error, "ユーザー詳細を取得できませんでした。")); }
	}

	function openFriendDetail(friend: FriendSummary) { void openUserDetail(friend.id, friend); }

	async function sendDetailFriendRequest() {
		if (!selectedFriend || userRelation !== "none") return;
		setFriendDetailStatus("submitting");
		try {
			const response = await fetch("/api/friend-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: selectedFriend.userId }) });
			if (!response.ok) throw await apiError(response, "フレンド申請を送信できませんでした。");
			setUserRelation("pending_outgoing");
			setFriendDetailStatus("complete");
			void loadFriends();
		} catch (error) { setFriendDetailStatus("error"); setFriendDetailMessage(errorMessage(error, "フレンド申請を送信できませんでした。")); }
	}

	async function loadStats(period: RankingPeriod) {
		setStatsStatus("submitting"); setStatsMessage("");
		try {
			const response = await fetch(`/api/stats?period=${period}`, { cache: "no-store", headers: { Accept: "application/json" } });
			if (!response.ok) throw await apiError(response, "戦績を取得できませんでした。通信状態を確認して再試行してください。");
			const data = (await response.json()) as { stats: PlayerStats };
			setStats(data.stats); setStatsStatus("complete");
		} catch (error) { setStatsStatus("error"); setStatsMessage(errorMessage(error, "戦績を取得できませんでした。")); }
	}

	useEffect(() => {
		const onPopState = () => setPathname(normalisePathname(window.location.pathname));
		const onPageShow = (event: PageTransitionEvent) => {
			setPathname(normalisePathname(window.location.pathname));
			if (event.persisted) setPageRestoreVersion((current) => current + 1);
		};
		window.addEventListener("popstate", onPopState);
		window.addEventListener("pageshow", onPageShow);
		return () => {
			window.removeEventListener("popstate", onPopState);
			window.removeEventListener("pageshow", onPageShow);
		};
	}, []);

	useEffect(() => {
		if (!isUserMenuOpen) return;
		const closeOnOutsidePointer = (event: PointerEvent) => {
			if (!userMenuRef.current?.contains(event.target as Node)) setUserMenuOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setUserMenuOpen(false);
		};
		document.addEventListener("pointerdown", closeOnOutsidePointer);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("pointerdown", closeOnOutsidePointer);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, [isUserMenuOpen]);

	useEffect(() => {
		const dialog = confirmDialogRef.current;
		if (!dialog) return;
		if (confirmation && !dialog.open) dialog.showModal();
		if (!confirmation && dialog.open) dialog.close();
	}, [confirmation]);

	async function acceptConfirmation() {
		if (!confirmation || confirmationPending) return;
		setConfirmationPending(true);
		try {
			await confirmation.action();
			setConfirmation(null);
		} finally {
			setConfirmationPending(false);
		}
	}

	useEffect(() => {
		void (async () => {
			try {
				const health = await fetch("/api/health");
				const body = (await health.json()) as { status: string };
				setHealthStatus(health.ok && body.status === "ok" ? "ready" : "unavailable");
			} catch {
				setHealthStatus("unavailable");
			}
			try {
				const me = await fetch("/api/me");
				if (!me.ok) { setAuthStatus("anonymous"); return; }
				const body = (await me.json()) as { user: User };
				setCurrentUser(body.user);
				const migration = await fetch("/api/auth/passkey-migration", { cache: "no-store" });
				if (migration.ok) {
					const status = (await migration.json()) as { required: boolean };
					setPasskeyMigrationRequired(status.required);
					if (status.required) {
						lockToPasskeyMigration();
						setAuthStatus("authenticated");
						return;
					}
				}
				setAuthStatus("authenticated");
				await loadSessions();
			} catch {
				setAuthStatus("anonymous");
			}
		})();
	}, []);

	useEffect(() => {
		if (authStatus !== "authenticated") return;
		const sessionId = sessionIdFor(pathname);
		if (sessionId) {
			void loadSessionDetail(sessionId).catch((error: unknown) => {
				setSelectedSession(null);
				setGameStatus("error");
				setGameMessage(errorMessage(error, "対局詳細を取得できませんでした。"));
			});
			return;
		}
		setSelectedSession(null);
		if (route === "history") void loadHistory();
		if (route === "rankings") void loadRankings(rankingPeriod);
		if (route === "friends" || route === "create") void loadFriends();
		if (route === "stats") void loadStats(statsPeriod);
		if (route === "passkey-migration") {
			setPasskeyMigrationRequired(null);
			void fetch("/api/auth/passkey-migration", { cache: "no-store" })
				.then(async (response) => {
					if (!response.ok) throw await apiError(response, "移行状態を確認できませんでした。ページを再読み込みしてください。");
					const body = (await response.json()) as { required: boolean };
					setPasskeyMigrationRequired(body.required);
				})
				.catch(() => { setPasskeyMigrationStatus("error"); setPasskeyMigrationMessage("移行状態を確認できませんでした。"); });
		}
	}, [authStatus, pageRestoreVersion, pathname, rankingPeriod, route, statsPeriod]);

	useEffect(() => {
		if (!currentUser) return;
		setProfileDisplayName(currentUser.displayName);
	}, [currentUser]);

	useEffect(() => {
		if (authStatus === "authenticated" && passkeyMigrationRequired === true && pathname !== "/settings/passkey-migration") {
			lockToPasskeyMigration();
		} else if (authStatus === "authenticated" && passkeyMigrationRequired === false && pathname === "/settings/passkey-migration") {
			window.history.replaceState({}, "", "/");
			setPathname("/");
		}
	}, [authStatus, passkeyMigrationRequired, pathname]);

	useEffect(() => {
		const sessionId = sessionIdFor(pathname);
		const shouldUseRealtime = Boolean(selectedSession && selectedSession.id === sessionId && selectedSession.status !== "closed");
		if (authStatus !== "authenticated" || !sessionId || !shouldUseRealtime) {
			setRealtimeStatus("idle");
			return;
		}

		let active = true;
		let socket: WebSocket | null = null;
		let reconnectTimer: number | undefined;
		let reconnectAttempt = 0;
		// Keep other clients current even if a WebSocket event is missed.
		const refreshTimer = window.setInterval(() => {
			if (!active) return;
			void loadSessionDetail(sessionId).catch(() => undefined);
		}, 30_000);

		const connect = () => {
			if (!active) return;
			setRealtimeStatus(reconnectAttempt === 0 ? "connecting" : "reconnecting");
			const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
			socket = new WebSocket(`${protocol}//${window.location.host}/ws/sessions/${encodeURIComponent(sessionId)}`);

			socket.addEventListener("open", () => {
				if (!active) return;
				reconnectAttempt = 0;
				setRealtimeStatus("connected");
				void loadSessionDetail(sessionId).catch(() => undefined);
			});

			socket.addEventListener("message", (event) => {
				if (!active || typeof event.data !== "string" || event.data === "pong") return;
				try {
					const message = JSON.parse(event.data) as { type?: string; sessionId?: string };
					if (
						message.sessionId === sessionId &&
						["session.member_joined", "session.draft_updated", "session.game_confirmed", "session.closed"].includes(message.type ?? "")
					) {
						void Promise.all([loadSessionDetail(sessionId), loadSessions()]).catch(() => undefined);
					}
				} catch {
					// Ignore messages that do not use the session event format.
				}
			});

			socket.addEventListener("close", () => {
				if (!active) return;
				reconnectAttempt += 1;
				setRealtimeStatus("reconnecting");
				const delayMs = Math.min(5_000, 500 * 2 ** Math.min(reconnectAttempt - 1, 4));
				reconnectTimer = window.setTimeout(connect, delayMs);
			});
		};

		connect();
		return () => {
			active = false;
			window.clearInterval(refreshTimer);
			if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
			socket?.close(1000, "Page changed");
		};
	}, [authStatus, pathname, selectedSession?.id, selectedSession?.status]);

	async function updateSignedInUser(response: Response) {
		const body = (await response.json()) as { user: User };
		const me = await fetch("/api/me", { cache: "no-store" });
		const canonical = me.ok ? (await me.json()) as { user: User } : body;
		setCurrentUser(canonical.user);
		setAuthStatus("authenticated");
		const migration = await fetch("/api/auth/passkey-migration", { cache: "no-store" });
		if (migration.ok) {
			const status = (await migration.json()) as { required: boolean };
			setPasskeyMigrationRequired(status.required);
			if (status.required) { lockToPasskeyMigration(); return; }
		}
		await loadSessions();
	}

	async function uploadAvatar(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!avatarFile) return;
		if (!["image/png", "image/webp"].includes(avatarFile.type)) {
			setAvatarStatus("error"); setAvatarMessage("PNGまたはWebP画像を選択してください。"); return;
		}
		if (avatarFile.size > 256 * 1024) {
			setAvatarStatus("error"); setAvatarMessage("画像は256KiB以下にしてください。"); return;
		}
		const form = event.currentTarget;
		setAvatarStatus("submitting"); setAvatarMessage("");
		try {
			const response = await fetch("/api/me/avatar", { method: "PUT", headers: { "Content-Type": avatarFile.type }, body: avatarFile });
			if (!response.ok) throw await apiError(response, "プロフィール画像を保存できませんでした。通信状態を確認してください。");
			const data = (await response.json()) as { avatarUpdatedAtMs: number };
			setCurrentUser((user) => user ? { ...user, avatarUpdatedAtMs: data.avatarUpdatedAtMs } : user);
			setAvatarFile(null); form.reset(); setAvatarStatus("complete"); setAvatarMessage("プロフィール画像を保存しました。");
		} catch (error) {
			setAvatarStatus("error"); setAvatarMessage(errorMessage(error, "プロフィール画像を保存できませんでした。"));
		}
	}

	async function removeAvatar() {
		if (!currentUser?.avatarUpdatedAtMs) return;
		setAvatarStatus("submitting"); setAvatarMessage("");
		try {
			const response = await fetch("/api/me/avatar", { method: "DELETE" });
			if (!response.ok) throw await apiError(response, "プロフィール画像を削除できませんでした。もう一度お試しください。");
			setCurrentUser((user) => user ? { ...user, avatarUpdatedAtMs: null } : user);
			setAvatarStatus("complete"); setAvatarMessage("プロフィール画像を削除しました。");
		} catch (error) {
			setAvatarStatus("error"); setAvatarMessage(errorMessage(error, "プロフィール画像を削除できませんでした。"));
		}
	}

	async function saveProfile(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setProfileStatus("submitting"); setProfileMessage("");
		try {
			const response = await fetch("/api/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: profileDisplayName }) });
			if (!response.ok) throw await apiError(response, "プロフィールを更新できませんでした。表示名を確認してください。");
			const body = (await response.json()) as { user: User };
			setCurrentUser(body.user); setProfileStatus("complete"); setProfileMessage("プロフィールを更新しました。");
		} catch (error) { setProfileStatus("error"); setProfileMessage(errorMessage(error, "プロフィールを更新できませんでした。")); }
	}

	async function createFriendRequest(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFriendStatus("submitting"); setFriendMessage("");
		try {
			const response = await fetch("/api/friend-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: friendUserId }) });
			if (!response.ok) throw await apiError(response, "フレンド申請を送信できませんでした。入力したユーザーIDを確認してください。");
			setFriendUserId(""); await loadFriends(); setFriendStatus("complete"); setFriendMessage("フレンド申請を送信しました。");
		} catch (error) { setFriendStatus("error"); setFriendMessage(errorMessage(error, "フレンド申請を送信できませんでした。")); }
	}

	async function respondToFriendRequest(requestId: string, accept: boolean) {
		setFriendStatus("submitting"); setFriendMessage("");
		try {
			const response = await fetch(`/api/friend-requests/${encodeURIComponent(requestId)}${accept ? "/accept" : ""}`, { method: accept ? "PATCH" : "DELETE" });
			if (!response.ok) throw await apiError(response, accept ? "フレンド申請を承認できませんでした。" : "フレンド申請を取り消せませんでした。");
			await loadFriends(); setFriendStatus("complete"); setFriendMessage(accept ? "フレンドになりました。" : "フレンド申請を取り消しました。");
		} catch (error) { setFriendStatus("error"); setFriendMessage(errorMessage(error, "フレンド申請を更新できませんでした。")); }
	}

	async function logout() {
		try {
			await fetch("/api/auth/logout", { method: "POST" });
		} finally {
			setCurrentUser(null); setSessions([]); setSelectedSession(null); setAuthStatus("anonymous"); navigate("/");
		}
	}

	async function deleteCurrentAccount() {
		setProfileStatus("submitting"); setProfileMessage("");
		try {
			const response = await fetch("/api/me", { method: "DELETE" });
			if (!response.ok) throw await apiError(response, "アカウントを削除できませんでした。");
			setCurrentUser(null); setSessions([]); setSelectedSession(null); setAuthStatus("anonymous"); navigate("/");
		} catch (error) {
			setProfileStatus("error"); setProfileMessage(errorMessage(error, "アカウントを削除できませんでした。"));
		}
	}

	async function registerPasskey(event: FormEvent<HTMLFormElement>) {
		event.preventDefault(); setRegistrationStatus("submitting"); setRegistrationMessage("");
		try {
			const optionsResponse = await fetch("/api/auth/register/options", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, displayName }) });
			if (!optionsResponse.ok) throw await apiError(optionsResponse, "パスキー登録を開始できませんでした。");
			const { challengeId, options } = (await optionsResponse.json()) as RegistrationOptionsResponse;
			const response = await startRegistration({ optionsJSON: options });
			const verificationResponse = await fetch("/api/auth/register/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId, response }) });
			if (!verificationResponse.ok) throw await apiError(verificationResponse, "パスキーを確認できませんでした。端末の認証を完了して、もう一度お試しください。");
			await updateSignedInUser(verificationResponse); setRegistrationStatus("complete"); setRegistrationMessage("登録してログインしました。");
		} catch (error) { setRegistrationStatus("error"); setRegistrationMessage(errorMessage(error, "アカウント登録を完了できませんでした。")); }
	}

	async function loginWithPasskey(event: FormEvent<HTMLFormElement>) {
		event.preventDefault(); setLoginStatus("submitting"); setLoginMessage("");
		try {
			const optionsResponse = await fetch("/api/auth/login/options", { method: "POST" });
			if (!optionsResponse.ok) throw await apiError(optionsResponse, "パスキーでのログインを開始できませんでした。");
			const { challengeId, options } = (await optionsResponse.json()) as LoginOptionsResponse;
			const response = await startAuthentication({ optionsJSON: options });
			const verificationResponse = await fetch("/api/auth/login/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId, response }) });
			if (!verificationResponse.ok) throw await apiError(verificationResponse, "パスキーを確認できませんでした。別のパスキーを選ぶか、もう一度お試しください。");
			await updateSignedInUser(verificationResponse); setLoginStatus("complete"); setLoginMessage("ログインしました。");
		} catch (error) { setLoginStatus("error"); setLoginMessage(errorMessage(error, "パスキーでログインできませんでした。")); }
	}

	async function loginWithPassword(event: FormEvent<HTMLFormElement>) {
		event.preventDefault(); setLoginStatus("submitting"); setLoginMessage("");
		try {
			const optionsResponse = await fetch("/api/auth/password/options", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: passwordUserId }) });
			if (!optionsResponse.ok) throw await apiError(optionsResponse, "パスワード認証を開始できませんでした。");
			const { challengeId, challenge, salt } = (await optionsResponse.json()) as PasswordLoginOptionsResponse;
			const proof = await createPasswordProof(password, salt, challenge);
			const verificationResponse = await fetch("/api/auth/password/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId, proof }) });
			if (!verificationResponse.ok) throw await apiError(verificationResponse, "メールアドレスまたはユーザーID、パスワードが正しくありません。");
			setPassword("");
			await updateSignedInUser(verificationResponse); setLoginStatus("complete"); setLoginMessage("ログインしました。"); navigate("/settings/passkey-migration");
		} catch (error) { setLoginStatus("error"); setLoginMessage(errorMessage(error, "パスワードでログインできませんでした。")); }
	}

	async function migratePasswordToPasskey() {
		setPasskeyMigrationStatus("submitting"); setPasskeyMigrationMessage("");
		try {
			const optionsResponse = await fetch("/api/auth/passkey-migration/options", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: migrationUserId }) });
			if (!optionsResponse.ok) throw await apiError(optionsResponse, "公開用ユーザーIDが使用済みか、入力形式が正しくありません。");
			const { challengeId, options } = (await optionsResponse.json()) as RegistrationOptionsResponse;
			const response = await startRegistration({ optionsJSON: options });
			const verificationResponse = await fetch("/api/auth/passkey-migration/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId, response }) });
			if (!verificationResponse.ok) throw await apiError(verificationResponse, "パスキーを登録できませんでした。旧メールアドレスとパスワードは削除されていません。");
			const me = await fetch("/api/me", { cache: "no-store" });
			if (me.ok) setCurrentUser(((await me.json()) as { user: User }).user);
			setPasskeyMigrationRequired(false); setPasskeyMigrationStatus("complete"); setPasskeyMigrationMessage("パスキーを登録し、旧メールアドレスとパスワードを削除しました。"); navigate("/"); await loadSessions();
		} catch (error) { setPasskeyMigrationStatus("error"); setPasskeyMigrationMessage(`${errorMessage(error, "パスキーへの移行を完了できませんでした。")} 旧メールアドレスとパスワードは削除されていません。`); }
	}

	async function createNewSession(event: FormEvent<HTMLFormElement>) {
		event.preventDefault(); setSessionStatus("submitting"); setSessionMessage("");
		try {
			const multiplierUnits = ruleMultiplier * 10_000;
			if (ruleMultiplier < 0.001 || !Number.isSafeInteger(Math.round(multiplierUnits)) || Math.abs(multiplierUnits - Math.round(multiplierUnits)) > 1e-8) throw new Error("係数は0.001以上、小数第4位までで入力してください。");
			if (Array.from({ length: playerCount }, (_, index) => ruleBonuses[index + 1]).reduce((total, bonus) => total + bonus, 0) !== 0) throw new Error("順位ボーナスの合計を0にしてください。");
			const response = await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: sessionName, playerCount, friendIds: selectedFriendIds.slice(0, playerCount - 1), rules: { baseScore: ruleBaseScore, scoreMultiplierBasisPoints: Math.round(multiplierUnits), rankBonusesMilli: Object.fromEntries(Array.from({ length: playerCount }, (_, index) => [index + 1, ruleBonuses[index + 1] * 1000])) } }) });
			if (!response.ok) throw await apiError(response, "セッションを作成できませんでした。設定内容を確認してください。");
			const body = (await response.json()) as { session: SessionSummary };
			setSessionName(""); await loadSessions(); setSessionStatus("idle"); navigate(`/sessions/${body.session.id}`);
		} catch (error) { setSessionStatus("error"); setSessionMessage(errorMessage(error, "セッションを作成できませんでした。")); }
	}

	async function joinExistingSession(event: FormEvent<HTMLFormElement>) {
		event.preventDefault(); setSessionStatus("submitting"); setSessionMessage("");
		try {
			const response = await fetch("/api/sessions/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ joinCode }) });
			if (!response.ok) throw await apiError(response, "セッションに参加できませんでした。参加コードを確認してください。");
			const body = (await response.json()) as { sessionId: string };
			setJoinCode(""); await loadSessions(); setSessionStatus("idle"); navigate(`/sessions/${body.sessionId}`);
		} catch (error) { setSessionStatus("error"); setSessionMessage(errorMessage(error, "セッションに参加できませんでした。")); }
	}

	async function confirmGame(event: FormEvent<HTMLFormElement>) {
		event.preventDefault(); if (!selectedSession || !currentUser) return;
		setGameStatus("submitting"); setGameMessage("");
		try {
			const response = await fetch(`/api/sessions/${selectedSession.id}/draft`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ finalScore: Number(gameScores[currentUser.id]), rank: gameRank ? Number(gameRank) : null }) });
			if (!response.ok) throw await apiError(response, "持ち点を保存できませんでした。入力値を確認してください。");
			await loadSessionDetail(selectedSession.id); setGameStatus("complete"); setGameMessage("持ち点を送信しました。");
		} catch (error) { setGameStatus("error"); setGameMessage(errorMessage(error, "持ち点を保存できませんでした。")); }
	}

	async function confirmDraftGame() {
		if (!selectedSession) return;
		setGameStatus("submitting"); setGameMessage("");
		try {
			const response = await fetch(`/api/sessions/${selectedSession.id}/games/confirm`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } });
			if (!response.ok) throw await apiError(response, "結果を確定できませんでした。入力人数・合計点・順位を確認してください。");
			await Promise.all([loadSessions(), loadSessionDetail(selectedSession.id)]); setGameStatus("complete"); setGameMessage("ゲーム結果を確定しました。");
		} catch (error) { setGameStatus("error"); setGameMessage(errorMessage(error, "ゲーム結果を確定できませんでした。")); }
	}

	async function closeSelectedSession() {
		if (!selectedSession) return;
		setGameStatus("submitting"); setGameMessage("");
		try {
			const response = await fetch(`/api/sessions/${selectedSession.id}/close`, { method: "POST" });
			if (!response.ok) throw await apiError(response, "セッションを終了できませんでした。作成者権限と現在の状態を確認してください。");
			await Promise.all([loadSessions(), loadSessionDetail(selectedSession.id)]); setGameStatus("complete"); setGameMessage("セッションを終了しました。履歴から確認できます。");
		} catch (error) { setGameStatus("error"); setGameMessage(errorMessage(error, "セッションを終了できませんでした。")); }
	}

	const visibleHistory = useMemo(() => {
		const now = new Date();
		const start = historyPeriod === "year" ? new Date(now.getFullYear(), 0, 1).getTime() : historyPeriod === "month" ? new Date(now.getFullYear(), now.getMonth(), 1).getTime() : 0;
		const query = historyQuery.trim().toLocaleLowerCase();
		const filtered = history.filter((item) => (start === 0 || item.closedAtMs >= start) && (historyPlayerCount === "all" || String(item.playerCount) === historyPlayerCount) && (!historyOpponent || item.members.some((member) => member.id === historyOpponent)) && (!query || (item.name ?? "").toLocaleLowerCase().includes(query) || item.members.some((member) => member.displayName.toLocaleLowerCase().includes(query) || member.userId.toLocaleLowerCase().includes(query))));
		return filtered.slice(0, Number(historyPageSize));
	}, [history, historyPeriod, historyPlayerCount, historyOpponent, historyPageSize, historyQuery]);
	const historyOpponents = useMemo(() => [...new Map(history.flatMap((item) => item.members).map((member) => [member.id, member])).values()].filter((member) => member.id !== currentUser?.id), [history, currentUser?.id]);

	if (authStatus === "checking") return <div className="loading-screen">ログイン状態を確認しています。</div>;
	if (authStatus === "anonymous") {
		const isSignUp = pathname === "/signin";
		const isPasswordLogin = pathname === "/login/password";
		return <main className="auth-screen"><section className="auth-panel auth-panel-standalone"><div className="auth-brand"><img className="brand-mark" src="/apple-touch-icon.png" alt="" /><span>ジャンポイ</span></div><div className="auth-panel-heading"><h1>{isSignUp ? "サインイン" : "ログイン"}</h1></div>{isSignUp ? <form onSubmit={registerPasskey}><label>ユーザーID<input autoComplete="username webauthn" maxLength={32} minLength={3} pattern="[A-Za-z0-9_-]{3,32}" required value={userId} onChange={(event) => setUserId(event.target.value)} /><small className="field-note">ユーザーIDは対局相手やフレンドなど、他の利用者にも表示されます。本名・メールアドレスなど個人情報は使用しないでください。</small></label><label>表示名<input maxLength={80} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><button className="auth-primary-button" disabled={registrationStatus === "submitting"} type="submit"><span>{registrationStatus === "submitting" ? "パスキーを確認中…" : "パスキーでサインイン"}</span><span>→</span></button></form> : isPasswordLogin ? <form onSubmit={loginWithPassword}><label>メールアドレスまたはユーザーID<input autoComplete="username" maxLength={255} minLength={3} required value={passwordUserId} onChange={(event) => setPasswordUserId(event.target.value)} /></label><label>パスワード<input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="auth-primary-button" disabled={loginStatus === "submitting"} type="submit"><span>{loginStatus === "submitting" ? "確認中…" : "ログイン"}</span><span>→</span></button></form> : <form onSubmit={loginWithPasskey}><button className="auth-primary-button" disabled={loginStatus === "submitting"} type="submit"><span>{loginStatus === "submitting" ? "パスキーを確認中…" : "パスキーでログイン"}</span><span>→</span></button></form>}{isSignUp && registrationMessage && <p aria-live="polite" className={`message ${registrationStatus}`}>{registrationMessage}</p>}{!isSignUp && loginMessage && <p aria-live="polite" className={`message ${loginStatus}`}>{loginMessage}</p>}<div className="auth-switch">{isSignUp ? <a href="/" onClick={(event) => followLink(event, "/")}>ログイン</a> : isPasswordLogin ? <a href="/" onClick={(event) => followLink(event, "/")}>パスキー認証はこちら</a> : <><a href="/signin" onClick={(event) => followLink(event, "/signin")}>サインイン</a><a className="auth-password-link" href="/login/password" onClick={(event) => followLink(event, "/login/password")}>パスワード認証はこちら</a></>}</div></section></main>;
	}
	if (passkeyMigrationRequired === true || route === "passkey-migration") {
		return <main className="auth-screen migration-lock-screen"><section className="card page-card passkey-migration-card" aria-labelledby="passkey-migration-title"><div className="auth-brand"><img className="brand-mark" src="/apple-touch-icon.png" alt="" /><span>ジャンポイ</span></div><div className="page-heading"><h1 id="passkey-migration-title">パスキーへ移行</h1><p>公開用ユーザーIDを決めて、次回からパスワードなしでログインします。</p></div>{passkeyMigrationRequired === null && passkeyMigrationStatus !== "error" ? <p className="hint">状態を確認しています。</p> : passkeyMigrationRequired ? <><label>公開用ユーザーID<input autoComplete="username" maxLength={32} minLength={3} pattern="[A-Za-z0-9_-]{3,32}" required value={migrationUserId} onChange={(event) => setMigrationUserId(event.target.value)} /><small className="field-note warning">このIDは対局相手やフレンドなど、他の利用者にも表示されます。本名・メールアドレスなど個人情報は使用しないでください。</small></label><div className="passkey-migration-note"><strong>登録完了後、旧メールアドレスとパスワードを削除します</strong><p>パスキー登録が完了するまでは削除しません。公開用IDは英数字・_・-の3〜32文字で入力してください。</p></div><button disabled={passkeyMigrationStatus === "submitting" || !/^[A-Za-z0-9_-]{3,32}$/.test(migrationUserId)} type="button" onClick={() => void migratePasswordToPasskey()}>{passkeyMigrationStatus === "submitting" ? "登録中…" : "パスキーを登録して旧認証情報を削除"}</button></> : <p className="hint">移行は完了しています。</p>}{passkeyMigrationMessage && <p aria-live="polite" className={`message ${passkeyMigrationStatus}`}>{passkeyMigrationMessage}</p>}</section></main>;
	}

	const sortedRankings = [...rankings].sort((left, right) => {
		const leftValue = rankingMetric === "total" ? left.totalPointsMilli : rankingMetric === "average" ? left.averagePointsMilli : left.topRateBasisPoints;
		const rightValue = rankingMetric === "total" ? right.totalPointsMilli : rankingMetric === "average" ? right.averagePointsMilli : right.topRateBasisPoints;
		return rightValue - leftValue || left.id.localeCompare(right.id);
	});
	const formatRankingValue = (player: RankingPlayer) => {
		if (rankingMetric === "topRate") return `${(player.topRateBasisPoints / 100).toLocaleString()}%`;
		const points = rankingMetric === "total" ? player.totalPointsMilli : player.averagePointsMilli;
		return `${(points / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} pt`;
	};
	const realtimeLabel = realtimeStatus === "connected" ? "同期中" : realtimeStatus === "reconnecting" ? "再接続中" : realtimeStatus === "connecting" ? "接続中" : "";
	return <AvatarDetailContext.Provider value={(userId) => { void openUserDetail(userId); }}><div className="app-shell"><aside className="sidebar" aria-label="メインナビゲーション"><div className="brand"><img className="brand-mark" src="/apple-touch-icon.png" alt="" /><span>ジャンポイ</span></div><nav className="sidebar-nav"><p className="nav-caption">メニュー</p><a className={`nav-item ${route === "dashboard" ? "active" : ""}`} href="/" onClick={(event) => followLink(event, "/")}><LayoutGrid />Dashboard{currentSession && <i className="nav-indicator active-session" />}</a><a className={`nav-item ${route === "friends" ? "active" : ""}`} href="/friends" onClick={(event) => followLink(event, "/friends")}><Users />Friends{incomingRequests.length > 0 && <i className="nav-indicator" />}</a><a className={`nav-item ${route === "rankings" ? "active" : ""}`} href="/rankings" onClick={(event) => followLink(event, "/rankings")}><Trophy />Rankings</a><a className={`nav-item ${route === "stats" ? "active" : ""}`} href="/stats" onClick={(event) => followLink(event, "/stats")}><BarChart3 />Stats</a></nav><div className="sidebar-footer"><a className={`nav-item ${route === "profile" ? "active" : ""}`} href="/settings/profile" onClick={(event) => followLink(event, "/settings/profile")}><Settings />Settings</a><div className="current-user">{currentUser && <UserAvatar userId={currentUser.id} displayName={currentUser.displayName} updatedAtMs={currentUser.avatarUpdatedAtMs} size="small" />}<div><strong>{currentUser?.displayName}</strong><small>@{currentUser?.userId}</small></div></div><p className={`health ${healthStatus}`}>API: {healthStatus === "ready" ? "利用可能" : healthStatus === "checking" ? "確認中" : "要確認"}</p></div></aside><main className="app-content"><header className="content-header"><a className="header-home-link" href="/" onClick={(event) => followLink(event, "/")} aria-label="ジャンポイのホームへ"><img className="brand-mark" src="/apple-touch-icon.png" alt="" /></a><span className="header-wordmark">JONG-POI</span><details className="header-user-menu" open={isUserMenuOpen} ref={userMenuRef} onToggle={(event) => setUserMenuOpen(event.currentTarget.open)}><summary aria-label="ユーザーメニュー">{currentUser && <UserAvatar userId={currentUser.id} displayName={currentUser.displayName} updatedAtMs={currentUser.avatarUpdatedAtMs} size="small" interactive={false} />}<span>{currentUser?.displayName}</span><ChevronDown /></summary><div><p><strong>{currentUser?.displayName}</strong><small>@{currentUser?.userId}</small></p><a href="/settings/profile" onClick={(event) => followLink(event, "/settings/profile")}><Settings />プロフィール設定</a><button type="button" onClick={() => void logout()}><LogOut />ログアウト</button></div></details></header>
		{route === "dashboard" && <><>{currentSession && <section className="active-session-card"><div><p>参加中のセッション</p><h2>{currentSession.name || "セッション"} / {currentSession.playerCount}人</h2><small>{currentSession.memberCount}人が参加中 · CODE: {currentSession.joinCode}</small></div><a className="button-link" href={`/sessions/${currentSession.id}`} onClick={(event) => followLink(event, `/sessions/${currentSession.id}`)}>セッションに戻る <Play /></a></section>}</><section className="action-grid" aria-label="対局メニュー"><article className="card"><PlusCircle /><h2>セッション作成</h2><p>ルールを設定し、参加コードを共有できます。</p><a className="text-link" href="/sessions/create" onClick={(event) => followLink(event, "/sessions/create")}>作成する →</a></article><article className="card"><ClipboardList /><h2>セッション参加</h2><p>共有された参加コードを入力して参加します。</p><a className="text-link" href="/sessions/join" onClick={(event) => followLink(event, "/sessions/join")}>コードを入力 →</a></article><article className="card"><History /><h2>自分の履歴</h2><p>終了したセッションのスコアとポイントを確認できます。</p><a className="text-link" href="/sessions/history" onClick={(event) => followLink(event, "/sessions/history")}>履歴を見る →</a></article></section></>}
		{route === "create" && <div className="session-create-page"><div className="page-heading"><h2>セッションを作成</h2><p>参加メンバーとルールを設定して半荘の記録を始めましょう</p></div><section className="card session-create-card"><header><h3>基本情報</h3><p>名前や参加人数、ルールを設定してください。</p></header><form onSubmit={createNewSession}><div className="create-field-grid"><label>セッション名（任意）<input maxLength={80} placeholder="2/12 夜会" value={sessionName} onChange={(event) => setSessionName(event.target.value)} /></label><label>参加人数<select value={playerCount} onChange={(event) => { const count = Number(event.target.value) as 3 | 4; setPlayerCount(count); setRuleBaseScore(count === 3 ? 35000 : 25000); setSelectedFriendIds((ids) => ids.slice(0, count - 1)); setRuleBonuses((current) => ({ ...current, [count]: -Array.from({ length: count - 1 }, (_, index) => current[index + 1]).reduce((total, bonus) => total + bonus, 0) })); }}><option value={4}>4人打ち</option><option value={3}>3人打ち</option></select></label></div><div className="create-friends"><div className="create-friends-header"><div><strong>招待するフレンド（最大 {playerCount - 1} 人）</strong><p>選択済み {selectedFriendIds.length} / {playerCount - 1}</p></div><button className="button-outline" type="button" disabled={friends.length === 0} onClick={() => friendSelectorRef.current?.showModal()}>フレンドを選ぶ</button></div>{friends.length === 0 ? <p className="hint">招待可能なフレンドがいません。フレンドページから追加してください。</p> : selectedFriendIds.length === 0 ? <p className="create-friends-empty">まだフレンドを選択していません。上の「フレンドを選ぶ」ボタンから招待してください。</p> : <div className="create-selected-friends">{friends.filter((friend) => selectedFriendIds.includes(friend.id)).map((friend) => <div key={friend.id}><UserAvatar userId={friend.id} displayName={friend.displayName} updatedAtMs={friend.avatarUpdatedAtMs} size="small" /><span>{friend.displayName}</span></div>)}</div>}</div><div className="create-field-grid"><label>基準点 (base)<input type="number" step="100" min="0" required value={ruleBaseScore} onChange={(event) => setRuleBaseScore(Number(event.target.value))} /></label><label>係数 (k)<input type="number" step="any" min="0.001" required value={ruleMultiplier} onChange={(event) => setRuleMultiplier(Number(event.target.value))} /></label></div><div className="create-bonuses"><strong>順位ボーナス (rank bonus)</strong><div className="create-field-grid">{Array.from({ length: playerCount }, (_, index) => index + 1).map((rank) => <label key={rank}>{rank}位<input type="number" step="100" required value={ruleBonuses[rank]} onChange={(event) => setRuleBonuses((current) => ({ ...current, [rank]: Number(event.target.value) }))} /></label>)}</div>{Array.from({ length: playerCount }, (_, index) => ruleBonuses[index + 1]).reduce((total, bonus) => total + bonus, 0) !== 0 && <p className="message error" role="alert">順位ボーナスの合計を0にしてください。</p>}</div><div className="create-actions"><button disabled={sessionStatus === "submitting"} type="submit">{sessionStatus === "submitting" ? "作成中…" : "セッションを作成"}</button></div></form>{sessionMessage && <p aria-live="polite" className={`message ${sessionStatus}`}>{sessionMessage}</p>}</section><dialog className="friend-detail-dialog friend-selector-dialog" ref={friendSelectorRef} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }} aria-labelledby="friend-selector-title"><header><div><h2 id="friend-selector-title">フレンドを選択</h2><p>招待したいフレンドをタップして選択・解除できます。</p></div></header><div className="friend-selector-list">{friends.map((friend) => { const selected = selectedFriendIds.includes(friend.id); return <button className={`friend-selector-item ${selected ? "selected" : ""}`} type="button" key={friend.id} disabled={!selected && selectedFriendIds.length >= playerCount - 1} onClick={() => setSelectedFriendIds((ids) => selected ? ids.filter((id) => id !== friend.id) : [...ids, friend.id])}><UserAvatar userId={friend.id} displayName={friend.displayName} updatedAtMs={friend.avatarUpdatedAtMs} size="large" /><span><strong>{friend.displayName}</strong><small>{friend.userId}</small></span><em>{selected ? "選択中" : "選択"}</em></button>; })}</div><footer><p>{selectedFriendIds.length >= playerCount - 1 ? "必要人数をすべて選択済みです" : `あと${playerCount - 1 - selectedFriendIds.length}人選べます`}</p><button type="button" onClick={() => friendSelectorRef.current?.close()}>完了</button></footer></dialog></div>}
		{route === "join" && <section className="card page-card" aria-labelledby="join-session-title"><div className="page-heading"><h2 id="join-session-title">セッションに参加</h2><p>作成者から共有された8文字の参加コードを入力してください。</p></div><form onSubmit={joinExistingSession}><label>参加コード<input maxLength={8} pattern="[A-Za-z2-9]{8}" required value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} /></label><div className="form-actions"><a className="button-outline button-link" href="/" onClick={(event) => followLink(event, "/")}>キャンセル</a><button disabled={sessionStatus === "submitting"} type="submit">{sessionStatus === "submitting" ? "参加中…" : "参加する"}</button></div></form>{sessionMessage && <p aria-live="polite" className={`message ${sessionStatus}`}>{sessionMessage}</p>}</section>}
		{route === "history" && <section className="history-page" aria-labelledby="history-title"><header className="history-page-header"><div><h2 id="history-title">セッション履歴</h2><p>{historyPeriod === "all" ? "全期間" : historyPeriod === "year" ? "今年" : "今月"}・{historyPlayerCount === "all" ? "全ルール" : `${historyPlayerCount}人打ち`}・{historyOpponent ? historyOpponents.find((member) => member.id === historyOpponent)?.displayName : "全員"}・{history.length}件</p></div><details className="history-filter"><summary><SlidersHorizontal />条件変更</summary><div><label className="history-filter-search">セッション名<input placeholder="セッション名" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} /></label><label>期間<select value={historyPeriod} onChange={(event) => setHistoryPeriod(event.target.value as typeof historyPeriod)}><option value="all">全期間</option><option value="year">今年</option><option value="month">今月</option></select></label><label>人数<select value={historyPlayerCount} onChange={(event) => setHistoryPlayerCount(event.target.value as typeof historyPlayerCount)}><option value="all">すべて</option><option value="3">3人打ち</option><option value="4">4人打ち</option></select></label><label className="history-filter-opponent">対戦相手<select value={historyOpponent} onChange={(event) => setHistoryOpponent(event.target.value)}><option value="">すべて</option>{historyOpponents.map((member) => <option value={member.id} key={member.id}>{member.displayName}</option>)}</select></label><label className="history-filter-per-page">1ページの表示件数<select value={historyPageSize} onChange={(event) => setHistoryPageSize(event.target.value as typeof historyPageSize)}><option value="10">10件</option><option value="50">50件</option><option value="100">100件</option></select></label></div></details></header>{historyStatus === "submitting" ? <section className="card history-empty"><p className="hint">履歴を読み込んでいます。</p></section> : historyStatus === "error" ? <section className="card history-empty"><div className="history-error"><p aria-live="polite" className="message error">{historyMessage || "履歴を取得できませんでした。"}</p><button className="button-outline" type="button" onClick={() => void loadHistory()}>もう一度読み込む</button></div></section> : visibleHistory.length === 0 ? <section className="card history-empty"><p className="hint">条件に一致する履歴がありません。</p></section> : <div className="history-cards">{visibleHistory.map((item) => <article className="card history-session-card" key={item.id}><header><div><h3>{item.name || "名称未設定の対局"} <small>・{item.playerCount}人打ち</small></h3><time>{new Date(item.closedAtMs).toLocaleString("ja-JP")}</time></div></header><div className="history-members">{item.members.map((member) => <UserAvatar key={member.id} userId={member.id} displayName={member.displayName} updatedAtMs={member.avatarUpdatedAtMs} size="small" />)}</div><div className="history-session-footer"><div className="history-stats"><dl><dt>合計ポイント</dt><dd>{(item.totalPointsMilli / 1000).toLocaleString()} pt</dd></dl><dl><dt>順位・半荘数</dt><dd>{item.rank ? `${item.rank}位` : "—"} ・ {item.gameCount}戦</dd></dl></div><a className="text-link" href={`/sessions/${item.id}`} onClick={(event) => followLink(event, `/sessions/${item.id}`)}>詳細を見る →</a></div></article>)}</div>}</section>}
		{route === "rankings" && <section className="card rankings-card" aria-labelledby="rankings-title"><div className="rankings-heading"><div className="page-heading"><h2 id="rankings-title">プレイヤーランキング</h2><p>終了したセッションのうち、5半荘以上の成績を集計します。</p></div><label>集計期間<select value={rankingPeriod} onChange={(event) => setRankingPeriod(event.target.value as RankingPeriod)}><option value="all">全期間</option><option value="year">今年</option><option value="month">今月</option></select></label></div><div className="ranking-tabs" aria-label="ランキング指標">{([{ key: "total", label: "累計ポイント" }, { key: "average", label: "平均ポイント" }, { key: "topRate", label: "トップ率" }] as const).map((metric) => <button className={rankingMetric === metric.key ? "active" : ""} key={metric.key} type="button" onClick={() => setRankingMetric(metric.key)}>{metric.label}</button>)}</div><p className="ranking-description">{rankingMetric === "total" ? "期間内のポイント合計順です。" : rankingMetric === "average" ? "1半荘あたりの平均ポイント順です。" : "トップ獲得率順です。"}</p>{rankingStatus === "submitting" ? <p className="hint">ランキングを読み込んでいます。</p> : rankingStatus === "error" ? <div className="history-error"><p aria-live="polite" className="message error">{rankingMessage}</p><button className="button-outline" type="button" onClick={() => void loadRankings(rankingPeriod)}>もう一度読み込む</button></div> : sortedRankings.length === 0 ? <p className="hint ranking-empty">ランキング対象のデータがありません。5半荘以上で掲載されます。</p> : <ol className="ranking-list">{sortedRankings.slice(0, 50).map((player, index) => <li key={player.id}><span className="ranking-position">#{index + 1}</span><UserAvatar userId={player.id} displayName={player.displayName} updatedAtMs={player.avatarUpdatedAtMs} /><div className="ranking-player"><strong>{player.displayName}</strong><small>@{player.userId}</small></div><div className="ranking-record"><small>参加 {player.gamesPlayed} 回 / トップ {player.topFinishes}</small><strong>{formatRankingValue(player)}</strong></div></li>)}</ol>}</section>}
		{route === "friends" && <div className="friends-page"><section className="card page-card friends-card" aria-labelledby="friends-title"><div className="page-heading"><h2 id="friends-title">フレンド</h2><p>ユーザーIDを指定してフレンド申請を送れます。</p></div><form className="friend-request-form" onSubmit={createFriendRequest}><label>ユーザーID<input maxLength={32} minLength={3} pattern="[A-Za-z0-9_-]{3,32}" placeholder="例: jongpoi_player" required value={friendUserId} onChange={(event) => setFriendUserId(event.target.value)} /></label><button disabled={friendStatus === "submitting"} type="submit">申請を送る</button></form>{friendMessage && <p aria-live="polite" className={`message ${friendStatus}`}>{friendMessage}</p>}<div className="friend-sections">{incomingRequests.length > 0 && <section><h3>届いた申請</h3>{incomingRequests.map((request) => <article className="friend-row" key={request.id}><UserAvatar userId={request.user.id} displayName={request.user.displayName} updatedAtMs={request.user.avatarUpdatedAtMs} /><div><strong>{request.user.displayName}</strong><small>@{request.user.userId}</small></div><button disabled={friendStatus === "submitting"} type="button" onClick={() => void respondToFriendRequest(request.id, true)}>承認</button><button className="button-outline" disabled={friendStatus === "submitting"} type="button" onClick={() => void respondToFriendRequest(request.id, false)}>削除</button></article>)}</section>}{outgoingRequests.length > 0 && <section><h3>送信した申請</h3>{outgoingRequests.map((request) => <article className="friend-row" key={request.id}><UserAvatar userId={request.user.id} displayName={request.user.displayName} updatedAtMs={request.user.avatarUpdatedAtMs} /><div><strong>{request.user.displayName}</strong><small>@{request.user.userId}</small></div><button className="button-outline" disabled={friendStatus === "submitting"} type="button" onClick={() => void respondToFriendRequest(request.id, false)}>取り消す</button></article>)}</section>}</div></section><section className="card page-card friend-list-card" aria-labelledby="friend-list-title"><h2 id="friend-list-title">フレンド一覧</h2><p>追加済みのフレンド。タップすると詳細を確認できます。</p>{friendStatus === "submitting" && friends.length === 0 ? <p className="hint">フレンドを読み込んでいます。</p> : friends.length === 0 ? <p className="hint">まだフレンドがいません。</p> : <div className="friend-list-grid">{friends.map((friend) => <button className="friend-list-item" type="button" key={friend.id} onClick={() => void openFriendDetail(friend)}><UserAvatar userId={friend.id} displayName={friend.displayName} updatedAtMs={friend.avatarUpdatedAtMs} size="large" /><span><strong>{friend.displayName}</strong><small>ユーザーID：{friend.userId}</small></span><em>詳細 →</em></button>)}</div>}</section></div>}
		{route === "stats" && <section className="stats-page" aria-labelledby="stats-title"><header className="page-section-header"><div><h2 id="stats-title">戦績</h2><p>終了したセッションの成績を集計します。</p></div><label>期間<select value={statsPeriod} onChange={(event) => setStatsPeriod(event.target.value as RankingPeriod)}><option value="all">全期間</option><option value="year">今年</option><option value="month">今月</option></select></label></header>{statsStatus === "submitting" ? <section className="card stats-card"><p className="hint">成績を読み込んでいます。</p></section> : statsStatus === "error" ? <section className="card stats-card"><div className="history-error"><p aria-live="polite" className="message error">{statsMessage}</p><button className="button-outline" type="button" onClick={() => void loadStats(statsPeriod)}>もう一度読み込む</button></div></section> : !stats || stats.summary.totalGames === 0 ? <section className="card stats-card"><p className="hint ranking-empty">この期間に終了した対局はまだありません。</p></section> : <><section className="card stats-summary-card"><div className="stats-total"><p>累計ポイント</p><strong>{(stats.summary.totalPointsMilli / 1000).toLocaleString()} <small>pt</small></strong><span>{stats.summary.totalSessions}セッション・{stats.summary.totalGames}戦</span></div><div className="stats-metrics"><dl><dt>平均順位</dt><dd>{stats.summary.averageRank?.toLocaleString() ?? "—"}位</dd></dl><dl><dt>平均ポイント</dt><dd>{((stats.summary.averagePointsMilli ?? 0) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} pt</dd></dl><dl><dt>トップ率</dt><dd>{((stats.summary.topRateBasisPoints ?? 0) / 100).toLocaleString()}%</dd></dl><dl><dt>連対率</dt><dd>{((stats.summary.topTwoRateBasisPoints ?? 0) / 100).toLocaleString()}%</dd></dl><dl><dt>ラス率</dt><dd>{((stats.summary.lastRateBasisPoints ?? 0) / 100).toLocaleString()}%</dd></dl><dl><dt>対局数</dt><dd>{stats.summary.totalGames}戦</dd></dl></div></section><div className="stats-detail-grid"><section className="card trend-card"><div className="trend-heading"><div><h3>直近{stats.trend.length}戦の推移</h3><p>最近の調子を確認できます。</p></div><div className="ranking-tabs chart-tabs" aria-label="表示する戦績"><button className={statsChartMode === "rank" ? "active" : ""} type="button" onClick={() => setStatsChartMode("rank")}>順位</button><button className={statsChartMode === "points" ? "active" : ""} type="button" onClick={() => setStatsChartMode("points")}>ポイント</button><button className={statsChartMode === "cumulative" ? "active" : ""} type="button" onClick={() => setStatsChartMode("cumulative")}>累積</button></div></div><StatsChart trend={stats.trend} mode={statsChartMode} /></section><section className="card distribution-card"><h3>順位分布</h3>{[1, 2, 3, 4].map((rank) => { const count = stats.rankCounts[rank] ?? 0; const percentage = Math.round((count / stats.summary.totalGames) * 100); return <div className={`rank-meter rank-${rank}`} key={rank}><p><span>{rank}位</span><span>{count}戦 <strong>{percentage}%</strong></span></p><i><b style={{ width: `${percentage}%` }} /></i></div>; })}</section></div><section className="card recent-games"><h3>直近10戦</h3>{stats.recentGames.map((game) => <article key={game.id}><div><strong>{game.sessionName || "セッション"} <small>・{game.playerCount}人打ち</small></strong><small>{new Date(game.playedAtMs).toLocaleString("ja-JP")}</small></div><span>{game.rank}位</span><strong>{(game.pointsMilli / 1000).toLocaleString()} pt</strong></article>)}</section></>}</section>}
		{route === "profile" && currentUser && <section className="card page-card profile-card" aria-labelledby="profile-title"><div className="page-heading"><h2 id="profile-title">プロフィール設定</h2><p>表示名とプロフィール画像を設定できます。</p></div><form onSubmit={saveProfile}><label>表示名<input maxLength={80} required value={profileDisplayName} onChange={(event) => setProfileDisplayName(event.target.value)} /></label><label>ユーザーID<input value={currentUser.userId} readOnly aria-readonly="true" /></label><div className="form-actions"><button disabled={profileStatus === "submitting"} type="submit">{profileStatus === "submitting" ? "保存中…" : "変更を保存"}</button></div></form>{profileMessage && <p aria-live="polite" className={`message ${profileStatus}`}>{profileMessage}</p>}<form className="avatar-form" onSubmit={uploadAvatar}><div className="profile-avatar-row"><UserAvatar userId={currentUser.id} displayName={currentUser.displayName} updatedAtMs={currentUser.avatarUpdatedAtMs} size="large" /><div><label>プロフィール画像<input accept="image/png,image/webp" type="file" onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)} /></label><p>PNGまたはWebP、最大256KiB</p></div></div><div className="form-actions profile-actions">{currentUser.avatarUpdatedAtMs != null && <button className="button-outline" disabled={avatarStatus === "submitting"} type="button" onClick={() => setConfirmation({ title: "プロフィール画像を削除しますか？", description: "現在のプロフィール画像を削除し、文字のアバターに戻します。", confirmLabel: "画像を削除", action: removeAvatar })}>画像を削除</button>}<button disabled={!avatarFile || avatarStatus === "submitting"} type="submit">{avatarStatus === "submitting" ? "保存中…" : "画像を保存"}</button></div></form>{avatarMessage && <p aria-live="polite" className={`message ${avatarStatus}`}>{avatarMessage}</p>}<section className="account-danger-zone" aria-labelledby="delete-account-title"><div><h3 id="delete-account-title">アカウント削除</h3><p>認証情報とプロフィールを削除します。対局履歴は匿名化して残ります。</p></div><button className="button-danger" disabled={profileStatus === "submitting"} type="button" onClick={() => setConfirmation({ title: "アカウントを削除しますか？", description: "パスキー、プロフィール、アバター、フレンド情報を削除します。この操作は元に戻せません。過去の対局履歴は匿名化して保持されます。", confirmLabel: "アカウントを削除", action: deleteCurrentAccount })}>アカウントを削除</button></section></section>}
		{route === "session" && <section className="session-detail-page" aria-labelledby="session-detail-title">{selectedSession ? <><header className="session-detail-header"><div><h2 id="session-detail-title">{selectedSession.name || "セッション詳細"}</h2><div className="session-code"><span>参加コード: <code>{selectedSession.joinCode}</code></span><button className="button-outline" type="button" onClick={() => void navigator.clipboard?.writeText(selectedSession.joinCode)}>コピー</button>{realtimeLabel && <span className={`realtime-status ${realtimeStatus}`}><i />{realtimeLabel}</span>}</div></div></header>{selectedSession.status !== "closed" && <ScoreEntryCard session={selectedSession} currentUserId={currentUser?.id} entries={draftEntries} score={gameScores[currentUser?.id ?? ""] ?? ""} rank={gameRank} status={gameStatus} onScoreChange={(value) => currentUser && setGameScores({ [currentUser.id]: value })} onRankChange={setGameRank} onSubmit={confirmGame} onConfirm={() => void confirmDraftGame()} />}{gameMessage && <p aria-live="polite" className={`message ${gameStatus}`}>{gameMessage}</p>}<section className="card totals-card"><header><h3>合計ポイント</h3><p>半荘の合計。加算順序に関わらず同じ計算式です。</p></header><div className="totals-grid">{selectedSession.members.map((member) => { const points = selectedSession.games.reduce((sum, game) => sum + (game.results.find((result) => result.userId === member.id)?.pointsMilli ?? 0), 0); const rank = 1 + selectedSession.members.filter((other) => selectedSession.games.reduce((sum, game) => sum + (game.results.find((result) => result.userId === other.id)?.pointsMilli ?? 0), 0) > points).length; return <div className={`total-player rank-${rank}`} key={member.id}><div><UserAvatar userId={member.id} displayName={member.displayName} updatedAtMs={member.avatarUpdatedAtMs} size="small" /><UserDetailName userId={member.id} displayName={member.displayName} /></div><b>{selectedSession.games.length > 0 ? `第${rank}位` : "順位未確定"}</b><strong>{(points / 1000).toLocaleString()} pt</strong></div>; })}</div></section><section className="card game-history"><h3>半荘履歴</h3>{selectedSession.games.length === 0 ? <p className="hint">まだ確定されたゲームはありません。</p> : selectedSession.games.map((game) => <details className="game-history-item" key={game.id}><summary><span className="game-history-heading"><strong>第{game.ordinal}回</strong><span className="game-history-date">{new Date(game.recordedAtMs).toLocaleString("ja-JP")}<ChevronDown /></span></span><span className="game-history-preview">{game.results.map((result) => <span className={`game-history-preview-player rank-${result.rank}`} key={result.userId}><span className="game-history-preview-rank">{result.rank}</span><UserAvatar userId={result.userId} displayName={result.displayName} updatedAtMs={selectedSession.members.find((member) => member.id === result.userId)?.avatarUpdatedAtMs} size="small" /></span>)}</span></summary><div className="game-result-grid">{game.results.map((result) => <div className={`game-result rank-${result.rank}`} key={result.userId}><div><UserAvatar userId={result.userId} displayName={result.displayName} updatedAtMs={selectedSession.members.find((member) => member.id === result.userId)?.avatarUpdatedAtMs} size="small" /><UserDetailName userId={result.userId} displayName={result.displayName} /></div><b>第{result.rank}位</b><small>{result.finalScore.toLocaleString()} 点</small><strong>{(result.pointsMilli / 1000).toLocaleString()} pt</strong></div>)}</div></details>)}</section>{selectedSession.ownerUserId === currentUser?.id && selectedSession.status !== "closed" && <div className="session-close"><button className="button-danger" disabled={gameStatus === "submitting"} type="button" onClick={() => setConfirmation({ title: "セッションを終了しますか？", description: "終了後は新しい半荘結果を入力できません。この操作は元に戻せません。", confirmLabel: "セッションを終了", action: closeSelectedSession })}>セッションを終了する</button></div>}</> : <section className="card detail-card"><p className="hint">{gameStatus === "error" ? gameMessage : "セッションを読み込んでいます。"}</p></section>}</section>}
		{route === "not-found" && <section className="card page-card"><h2>ページが見つかりません</h2><p>指定されたページは存在しないか、まだ移行されていません。</p><a className="button-link" href="/" onClick={(event) => followLink(event, "/")}>ダッシュボードへ戻る</a></section>}
		<dialog className="confirm-dialog" ref={confirmDialogRef} onCancel={(event) => { if (confirmationPending) event.preventDefault(); else setConfirmation(null); }} onClick={(event) => { if (event.target === event.currentTarget && !confirmationPending) setConfirmation(null); }} aria-labelledby="confirm-dialog-title"><h2 id="confirm-dialog-title">{confirmation?.title}</h2><p>{confirmation?.description}</p><div className="confirm-dialog-actions"><button className="button-outline" disabled={confirmationPending} type="button" onClick={() => setConfirmation(null)}>キャンセル</button><button className="button-danger" disabled={confirmationPending} type="button" onClick={() => void acceptConfirmation()}>{confirmationPending ? "処理中…" : confirmation?.confirmLabel}</button></div></dialog>
		</main><dialog className="friend-detail-dialog" ref={friendDialogRef} onClose={() => setSelectedFriend(null)} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }} aria-labelledby="friend-detail-title"><header><div><h2 id="friend-detail-title">ユーザー詳細</h2><p>累計ポイントと直近10戦の記録を確認できます。</p></div><button className="button-outline" type="button" onClick={() => friendDialogRef.current?.close()} aria-label="閉じる">閉じる</button></header>{friendDetailStatus === "submitting" && !selectedFriend && <p className="hint">読み込んでいます。</p>}{friendDetailStatus === "error" && !selectedFriend && <p className="message error">{friendDetailMessage}</p>}{selectedFriend && <div className="friend-detail-body"><div className="friend-detail-identity"><UserAvatar userId={selectedFriend.id} displayName={selectedFriend.displayName} updatedAtMs={selectedFriend.avatarUpdatedAtMs} size="large" interactive={false} /><div><strong>{selectedFriend.displayName}</strong><small>ユーザーID：{selectedFriend.userId}</small></div></div><div className="friend-detail-total"><span>累計ポイント</span><strong>{(selectedFriend.totalPointsMilli / 1000).toLocaleString()} pt</strong></div><section className="friend-detail-games"><h3>直近10戦</h3>{friendDetailStatus === "submitting" ? <p className="hint">読み込んでいます。</p> : friendDetailStatus === "error" ? <p className="message error">{friendDetailMessage}</p> : friendDetailStats?.recentGames.length ? friendDetailStats.recentGames.map((game) => <div className="friend-detail-game" key={game.id}><div><strong>{game.sessionName || "セッション"}</strong><b className={game.pointsMilli > 0 ? "positive" : game.pointsMilli < 0 ? "negative" : ""}>{(game.pointsMilli / 1000).toLocaleString()} pt</b></div><small>{new Date(game.playedAtMs).toLocaleString("ja-JP")} ・ {game.rank}位</small></div>) : <p className="hint">まだ対局データがありません。</p>}</section><div className="friend-detail-relation"><p>{userRelation === "self" ? "これはあなた自身の情報です。" : userRelation === "friend" ? "既にフレンドになっています。" : userRelation === "pending_outgoing" ? "フレンド申請を送信済みです。相手の承認をお待ちください。" : userRelation === "pending_incoming" ? "相手からのフレンド申請が保留中です。Friendsページで承認してください。" : "まだフレンドではありません。"}</p>{userRelation === "none" && <button type="button" disabled={friendDetailStatus === "submitting"} onClick={() => void sendDetailFriendRequest()}>フレンド申請を送る</button>}</div></div>}</dialog><nav className="mobile-nav" aria-label="モバイルナビゲーション"><a className={route === "dashboard" ? "active" : ""} href="/" onClick={(event) => followLink(event, "/")}><LayoutGrid />Dashboard</a><a className={route === "friends" ? "active" : ""} href="/friends" onClick={(event) => followLink(event, "/friends")}><Users />Friends</a><a className={route === "rankings" ? "active" : ""} href="/rankings" onClick={(event) => followLink(event, "/rankings")}><Trophy />Rankings</a><a className={route === "stats" ? "active" : ""} href="/stats" onClick={(event) => followLink(event, "/stats")}><BarChart3 />Stats</a><a className={route === "profile" ? "active" : ""} href="/settings/profile" onClick={(event) => followLink(event, "/settings/profile")}><Settings />Settings</a></nav></div></AvatarDetailContext.Provider>;
}

export default App;
