# ジャングルバルーンシューティング（改造版）

先輩作成版の通信構成（Firebase・ジャイロ送信・発射カウンター方式）を
土台にした改造版です。

## 今回の改造内容

- **2人同時スタートの廃止**：これまでは2人ともスマホをつないで「スタート」を
  押さないとゲームが始まりませんでしたが、今回からは PLAYER 1 / PLAYER 2 が
  それぞれ完全に独立してプレイできます。片方だけ接続してすぐに遊ぶことも、
  片方が先に終わってもう一度遊ぶことも可能です。
- **金の風船を削除**：`goldballoon.png` の出現・加点処理を廃止しました。
- **得点を統一**：残った赤・青・黄の風船は、1個あたり **1点→10点** に変更しました。
- **スタート方法の変更**：スマホの「スタート」ボタン（タップ操作）は廃止しました。
  代わりに、PC画面の各プレイヤー側に表示される **「STARTのまと」** を、
  スマホの発射ボタンでジャイロ照準を合わせて撃つことでゲームが始まります。
  風船を撃つときと同じ「狙って発射」の操作でスタートできます。

## 追加した要素：ドロップアイテム

- 風船を割ると、ドロップアイテムを入手できることがあります。
  - **1個目の風船を割ったとき**：`clothes.png`（探検服）が **100%** ドロップします。
  - **2個目以降**：まだ入手していないアイテムの中からランダムに1種類、
    **40%の確率** でドロップします。
  - 各アイテムは、そのプレイ中に**1回しかドロップしません**。
- アイテムがドロップすると、風船が割れた位置から
  ふわっと登場し、少し経つとフェードアウトして消えるアニメーションが再生されます。
- ゲーム終了時のスコア画面に「アイテム ○ / ○ 種類ゲット！」という表示と、
  実際に入手したアイテムのアイコンが表示されます。

### アイテムの追加方法

`script.js` 内の `DROP_ITEMS` 配列にオブジェクトを追加するだけで、
アイテムの種類を増やせるように作ってあります（現在3種類→将来6種類に対応可能）。

```js
const DROP_ITEMS = [
  { id: "clothes", image: "images/clothes.png", name: "探検服" },
  { id: "cap", image: "images/cap.png", name: "探検帽" },
  { id: "compass", image: "images/compass.png", name: "コンパス" },
  { id: "glass", image: "images/glass.png", name: "虫めがね" },
  { id: "map", image: "images/map.png", name: "たからの地図" },
  { id: "pickaxe", image: "images/pickaxe.png", name: "つるはし" }
];
```

現在、予定していた6種類すべてのドロップアイテムが実装済みです
（`clothes` / `cap` / `compass` / `glass` / `map` / `pickaxe`）。

`id` はユニークであれば自由に決められます。`GUARANTEED_FIRST_ITEM_ID`
（現在は `"clothes"`）を変更すると、1個目で必ずドロップするアイテムを
切り替えられます。

## 維持した部分

- `shared/firebase.js` のFirebase設定・匿名認証・接続処理
- `shared/room-code.js` の4文字コード生成・URL作成
- `rooms/{roomId}/aim`
- `rooms/{roomId}/fireCounter`
- `rooms/{roomId}/phoneConnected`
- スマホのジャイロ送信と発射カウンター方式

## フォルダ構成

- `index.html`：PC側
- `smartphone.html`：スマホ側
- `script.js`：PC側ゲーム処理
- `phone.js`：スマホ側操作
- `shared/firebase.js`：先輩版のFirebase共通処理
- `shared/room-code.js`：先輩版の接続コード処理
- `images/clothes.png` `images/cap.png` `images/compass.png`
  `images/glass.png` `images/map.png` `images/pickaxe.png`：ドロップアイテム画像

GitHub Pagesへフォルダ構成のままアップロードしてください。
