# GitLab Docs Navigator

GitLab のグループ、サブグループ、リポジトリに分散した Markdown 文書を収集し、階層表示と全文検索を行う FastAPI 製 Web アプリです。

## 起動

`.env.example` を `.env` にコピーし、接続先を編集します。

```powershell
Copy-Item .env.example .env
# .env の GITLAB_URL、GITLAB_GROUP、必要に応じて GITLAB_TOKEN を編集
python -m pip install -r requirements.txt
python app.py
```

起動時にプロジェクト直下の `.env` が自動で読み込まれます。OS 側ですでに設定されている環境変数は `.env` より優先されます。ブラウザで <http://localhost:8000> を開きます。環境変数を設定しない場合は、組み込みのデモ文書が表示されます。

### 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `GITLAB_URL` | なし | GitLab の URL |
| `GITLAB_TOKEN` | なし | 任意。非公開文書では `read_api` / `read_repository` 権限のアクセストークン |
| `GITLAB_GROUP` | なし | ルートグループの ID またはフルパス |
| `GITLAB_LINK_BRANCH` | `main` | 「GitLabで開く」ボタンのブランチ。`main` または `draft` |
| `DOC_EXTENSIONS` | `.md,.mdx,.txt,.rst,.adoc` | 収集対象の拡張子 |
| `DOC_MAX_BYTES` | `1000000` | 文書 1 ファイルの最大サイズ |
| `CACHE_TTL_SECONDS` | `300` | GitLab データのキャッシュ秒数 |
| `PORT` | `8000` | 待受ポート |

公開グループと公開リポジトリだけを扱う場合、トークンは不要です。指定したトークンはサーバー内だけで使われ、ブラウザには送信されません。画面右上で `main` / `draft` ブランチを切り替え、「強制取得」で表示中のブランチのキャッシュを更新できます。

## API

- `GET /api/tree` — グループ、プロジェクト、文書の階層
- `GET /api/doc?id=...` — 文書本文
- `GET /api/search?q=...` — タイトル、パス、本文を検索
- `POST /api/refresh?branch=main|draft` — 指定ブランチを GitLab から強制再取得
- `GET /api/health` — 稼働状態

FastAPI が生成する API ドキュメントは <http://localhost:8000/docs> で確認できます。

## テスト

```powershell
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests
```

## Azure Red Hat OpenShift

ARO 用のコンテナ定義とマニフェストは、`Dockerfile` と
`deploy/aro.yaml` にあります。

1. `deploy/aro.yaml` の `GITLAB_URL`、`GITLAB_GROUP`、`YOUR_ACR` を環境に合わせて変更します。
2. 対象の OpenShift プロジェクトで ACR Pull Secret を作成します。非公開文書を取得する場合だけ、GitLab トークンの Secret も作成します。

```powershell
oc create secret docker-registry acr-pull-secret `
  --docker-server="<ACR name>.azurecr.io" `
  --docker-username="<ACR username>" `
  --docker-password="<ACR password>" `
  --docker-email="unused@example.com"
```

3. ACR でイメージをビルドし、マニフェストを適用します。

```powershell
az acr build `
  --registry "<ACR name>" `
  --image "docsviewer:1.0.0" `
  .

oc apply -f deploy/aro.yaml
oc rollout status deployment/docsviewer
oc get route docsviewer
```

非公開文書を取得する場合は、追加で次の Secret を作成します。

```powershell
oc create secret generic docsviewer-gitlab `
  --from-literal=GITLAB_TOKEN="<GitLab token>"
```

GitLab トークンをソースコードやマニフェストへ直接記載しないでください。
