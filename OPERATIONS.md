# ジャンポイ Next 運用・本番移行手順

Cloudflare DashboardとWranglerによる変更操作は、管理者本人が実施する。Codexは設定・検証・手順の準備を担当する。

## 1. ステージング受け入れ確認

公開範囲の自動確認:

```bash
npm run smoke:staging
```

ブラウザで次を確認する。

- パスキーでログインできる
- 対局を作成し、別ユーザーが参加できる
- 2画面で参加・ゲーム確定・終了がリアルタイム反映される
- 終了した対局が履歴とランキングへ反映される
- SettingsでPNGまたはWebPのアバターを登録・削除できる
- アバターがサイドバー、ランキング、対局メンバーに表示される
- スマートフォン幅で主要操作ができる

## 2. 本番専用D1の作成

本番D1は `jong-poi-production`、ステージングD1は `jong-poi-development` として分離する。`npm run deploy:production` は両環境のD1 IDが同じ場合、安全装置により失敗する。

新しく作り直す場合は、Cloudflare操作担当者が次を実行する。

```bash
npx wrangler d1 create jong-poi-production
```

表示されたDatabase IDを `wrangler.json` 直下の `d1_databases[0].database_id` に設定する。`env.staging` のIDは変更しない。現在の本番Database IDは `d64d9753-d53d-4455-b727-806fe1400b04`。

```bash
npm run check:production-config
npx wrangler d1 migrations apply jong-poi-production --remote
```

## 3. バックアップと復元確認

ステージングのバックアップ例:

```bash
mkdir -p backups
npx wrangler d1 export jong-poi-development --remote --output backups/jong-poi-development.sql
```

エクスポートファイルにはユーザーデータが含まれるため、`backups/` はGit管理しない。復元演習は本番DBではなく、一時的な検証用D1で実施する。

## 4. 本番デプロイと切替

### 旧パスワード認証を有効にする場合

`0005_legacy_password_login.sql` と `0006_private_legacy_login_id.sql` の適用後、切替直前の旧Laravel DBから旧 `user_id` とbcrypt済み `password` を安全な一時領域へ抽出する。メール形式の旧 `user_id` は公開用 `users.user_id` へ入れず、非公開の `users.legacy_login_id` へ保存する。ハッシュは `users.legacy_password_hash` へ対応付ける。平文パスワードへの復号・再ハッシュは行わない。移行ファイルはGit管理せず、D1への反映と件数照合が完了したら削除する。

ハッシュが未移行の利用者はパスワード画面からログインできないため、切替前に次を照合する。

- 旧DBの対象ユーザー数
- D1で `legacy_password_hash IS NOT NULL` のユーザー数
- 抽出した複数ユーザーでのログイン成功
- 誤ったパスワードでログインできないこと

本番専用D1へのマイグレーションとバックアップを確認後に実行する。

```bash
npm run deploy:production
```

その後、Cloudflareで `jong-poi.misoon.net` を新Workerへ接続する。切替直後はConoHa VPSを停止せず、DNSを戻せる状態で保持する。

## 5. ロールバック

重大な問題が出た場合は、Cloudflareのカスタムドメインを新Workerから外し、旧ConoHa側のDNS設定へ戻す。新D1のデータは削除せず、障害調査と再移行に備えてエクスポートする。
