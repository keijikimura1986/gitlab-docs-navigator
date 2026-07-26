# GitLab Docs Navigator

GitLab のグループ、サブグループ、リポジトリに分散した Markdown 文書を収集し、階層表示と全文検索を行う軽量 Web アプリです。外部パッケージなしで動作します。

## 起動

```powershell
$env:GITLAB_URL = "https://gitlab.example.com"
$env:GITLAB_TOKEN = "glpat-..."
$env:GITLAB_GROUP = "your-group"
python app.py
```

ブラウザで <http://localhost:8000> を開きます。環境変数を設定しない場合は、組み込みのデモ文書が表示されます。

### 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `GITLAB_URL` | なし | GitLab の URL |
| `GITLAB_TOKEN` | なし | `read_api` / `read_repository` 権限のアクセストークン |
| `GITLAB_GROUP` | なし | ルートグループの ID またはフルパス |
| `DOC_EXTENSIONS` | `.md,.mdx,.txt,.rst,.adoc` | 収集対象の拡張子 |
| `DOC_MAX_BYTES` | `1000000` | 文書 1 ファイルの最大サイズ |
| `CACHE_TTL_SECONDS` | `300` | GitLab データのキャッシュ秒数 |
| `PORT` | `8000` | 待受ポート |

トークンはサーバー内だけで使われ、ブラウザには送信されません。画面右上の「GitLabから再取得」でキャッシュを更新できます。

## API

- `GET /api/tree` — グループ、プロジェクト、文書の階層
- `GET /api/doc?id=...` — 文書本文
- `GET /api/search?q=...` — タイトル、パス、本文を検索
- `POST /api/refresh` — GitLab から強制再取得
- `GET /api/health` — 稼働状態

## テスト

```powershell
python -m unittest discover -s tests
```

## Azure Red Hat OpenShift

ARO 用のコンテナ定義とマニフェストは、`Dockerfile` と
`deploy/aro.yaml` にあります。

1. `deploy/aro.yaml` の `GITLAB_URL`、`GITLAB_GROUP`、`YOUR_ACR` を環境に合わせて変更します。
2. 対象の OpenShift プロジェクトで、GitLab トークンと ACR Pull Secret を作成します。

```powershell
oc create secret generic docsviewer-gitlab `
  --from-literal=GITLAB_TOKEN="<GitLab token>"

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

GitLab トークンをソースコードやマニフェストへ直接記載しないでください。
