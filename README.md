# ジャンポイ Next

Cloudflare Workersの無料枠で構築する、リアルタイム対局記録アプリです。

## 技術構成

- React + TypeScript + Vite
- Hono on Cloudflare Workers
- Cloudflare D1（ユーザー・対局・ゲーム結果）
- Durable Objects + WebSocket（対局単位の排他制御・リアルタイム通知）

設計方針はプロジェクトルートの [`ARCHITECTURE.md`](../../ARCHITECTURE.md) を参照してください。

## ローカル開発

```bash
npm run dev
```

ブラウザで表示される画面と、`GET /api/health` がどちらも動作することを確認します。
このAPIはD1へ `SELECT 1` を実行し、DBに到達できた場合だけ `database: "ok"` を返します。

`GET /api/me` は認証済みユーザーを返し、セッションCookieがない場合は `401` を返します。

`POST /api/auth/register/options` は、`jong-poi.misoon.net` 用のパスキー登録オプションと一回限りのチャレンジを発行する。`POST /api/auth/register/verify` は応答を検証して、ユーザー・公開鍵・ログインCookieを作成する。`/api/auth/login/*` は同じパスキーでの再ログインを担当する。利用前に `0002_webauthn_challenges.sql` をD1へ適用する。

`/login/password` は旧Laravel版から移行した利用者向けの互換ログイン画面。`0005_legacy_password_login.sql` と `0006_private_legacy_login_id.sql` を適用し、旧メールアドレスは非公開の `users.legacy_login_id`、bcryptハッシュは `users.legacy_password_hash` へ移した利用者だけが使用できる。bcrypt計算はブラウザで行い、APIにはパスワードではなく一回限りのチャレンジに対するHMAC証明だけを送る。ハッシュやパスワードをログ、Git、コマンド履歴へ残さないこと。

パスワード認証後は `/settings/passkey-migration` へ移動し、公開用ユーザーIDを選択する。公開IDの更新、パスキーの保存、WebAuthnチャレンジの消費、`legacy_login_id` と `legacy_password_hash` の削除は同じD1バッチで実行されるため、パスキー登録に失敗した場合は旧認証情報を維持する。

認証済みの利用者は `/api/sessions` で対局を作成・一覧し、`/api/sessions/join` で8文字の参加コードから参加できる。初期プリセットは25,000点持ち・4人戦で、3人戦も明示的に指定できる。

対局詳細を開くと `/ws/sessions/:id` に接続する。参加、ゲーム結果の確定、セッション終了が発生するとDurable Objectが接続中の参加者へ通知し、各ブラウザがD1の最新状態を再取得する。高頻度のポーリングやハートビートは行わない。

`GET /api/rankings?period=all|year|month` は、終了済み対局を対象に5半荘以上のプレイヤーを集計する。画面では累計ポイント、平均ポイント、トップ率を切り替えて確認できる。初期規模ではD1から読み取り時に集計し、Cron Triggerは使用しない。

`GET /api/stats?period=all|year|month` はログイン中の利用者の成績（対局数、累計・平均ポイント、順位率、最近の対局）を返す。`GET /api/friends` と `/api/friend-requests` はユーザーIDを使ったフレンド申請・承認・取消を扱う。フレンド関係の承認時はD1のバッチで関係の作成と申請の完了をまとめて処理する。

`PATCH /api/me` ではログイン中の利用者の表示名を変更できる。ユーザーIDは登録時に決まり、プロフィール画面やAPIから変更できない。

`PUT /api/me/avatar` と `DELETE /api/me/avatar` でプロフィール画像を登録・削除する。PNGまたはWebPだけを受け付け、ファイル署名を検査し、アプリ側の上限を256KiBとする。画像はD1の `user_avatars` に保存し、`GET /api/users/:userId/avatar` から認証済み利用者へ配信する。

Cookie認証を使う更新APIは同一オリジンのリクエストだけを受け付ける。WebSocket接続もOriginと対局メンバー資格を確認する。

## 検証

```bash
npm run check
npm test
```

`npm test` は得点計算、D1クエリ、対局履歴、ランキング、成績、フレンド関係、プロフィール更新、アバターの実データ検査、Durable Objectの更新通知・同時更新、未認証・クロスサイトアクセス拒否を検証する。

## デプロイ

ステージングへ反映する場合は、先にステージングD1へマイグレーションを適用する。半荘結果の個別入力には `0004_game_draft_entries.sql` が必要。

```bash
npm run migrate:staging
npm run deploy:staging
```
