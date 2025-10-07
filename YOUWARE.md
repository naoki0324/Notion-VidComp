# Notion Uploader Compressor Guide

本プロジェクトはブラウザ内で動画圧縮を実行し、Notion 無料プランの 5 MB 制限に収まるファイルを素早く生成する React + TypeScript アプリケーションです。FFmpeg.wasm v0.12 系を利用し、サーバーやデータベースを持たずにユーザーのローカル環境で完結させます。

## 主要機能

- 動画ファイル（MP4/MOV/WEBM 等）のアップロードとブラウザ内圧縮
- H.264（MP4）/VP9（WEBM）への変換、CRF・プリセット・解像度の調整
- 圧縮進捗と FFmpeg ログのリアルタイム表示、エラー時のフィードバック
- 出力動画のプレビューとダウンロードリンク生成
- Notion 無料プラン 5 MB 制限リマインダー（ログと UI 表示）

## 技術スタック

- **React 18 + TypeScript**
- **Vite 7**（ビルド）
- **Tailwind CSS 3**（スタイル）
- **FFmpeg.wasm 0.12.2 + @ffmpeg/util 0.12.2**（動画処理）
- **JSDelivr CDN** から `@ffmpeg/core@0.12.10` を ESM 形式で読み込み（Vite 環境向け）

## 開発コマンド

```bash
npm install
npm run build
```

`npm run build` で本番ビルドが生成され、`dist/` に成果物が出力されます。

## 実装上のポイント

- `src/App.tsx` に単一ページ構成の UI と圧縮ロジックを実装
  - `FFmpeg` クラスを `new FFmpeg()` で生成し、`load` 時に `toBlobURL` で Core/wasm を取得
  - `ffmpeg.writeFile`, `ffmpeg.exec`, `ffmpeg.readFile`, `ffmpeg.deleteFile` を使用
  - `ffmpeg.on('log')`, `ffmpeg.on('progress')` でログ／進捗を取得
  - 圧縮パラメータ（CRF・プリセット・解像度・フォーマット）を UI から指定可能
  - 圧縮後は Blob URL を生成してプレビュー＆ダウンロード
- 失敗時はエラーメッセージをログに表示し、ファイルクリーンアップを試行
- 同期的な FFmpeg ロードを避けるため、Promise をキャッシュして二重ロードを防止
- ログはクライアントのみで保持し、データはサーバーへ送信しない

## デザインと UX

- 暖色寄りのニュートラルなグラデーション背景とカード UI
- Tailwind ベースのレスポンシブ設計（モバイル〜デスクトップ）
- 圧縮アクション時にボタンの状態変更、進捗テキスト表示
- 活動ログパネルで実行状態を時系列に確認可能

## 今後の拡張候補

- 画像圧縮への対応（FFmpeg もしくは別ライブラリの活用）
- Preset/CRF のプリセット保存や Notion 連携 API の検討
- マルチスレッド版（core-mt）や SharedArrayBuffer 対応環境での高速化

## 注意事項

- Notion 無料プランのアップロード上限は 1 ファイル 5 MB（2025 年 10 月時点）。UI やログでユーザーに常時通知
- ブラウザでの WASM 実行のため、端末性能やブラウザによって処理速度が変動
- クロスオリジン制約緩和のため `toBlobURL` を利用して Core/wasm を読み込み
- 依存パッケージ更新時は FFmpeg API 変更（0.12 系）に注意

## ファイル構成の目安

- `src/App.tsx`：UI/ロジックの中心。変換設定・ログ管理・FFmpeg 呼び出し
- `src/main.tsx`：React ルートマウント
- `src/index.css`：Tailwind 取り込みとベーススタイル

## メンテナンスポイント

- FFmpeg Core の CDN バージョン（`CORE_BASE_URL`）を適宜更新
- Tailwind 設定や配色の調整は `index.css` または `tailwind.config.js` を編集
- 任意で i18n や状態管理（Zustand など）を導入する際は既存実装を参考に

---

本ガイドはブラウザ完結型の Notion アップロード支援ツールとしての開発・保守を前提にしています。追加要件や Notion 仕様変更時は、上記の設計方針と注意点を踏まえて改修してください。