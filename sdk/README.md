# lite-board SDK

브라우저 없이 lite-board 앱이 하는 일을 모두 합니다. 보드를 만들고 고치고, **공유 링크**, **`.liteboard`**, **`.tldr`**(tldraw), **SVG**, **PNG**로 내보내고, 링크·`.liteboard`·`.tldr`를 읽어 들입니다.

lite-board의 공유 링크는 `#b=` 뒤에 보드 전체를 압축해 담고, 서버에는 아무것도 저장하지 않습니다. 그래서 규칙만 알면 어떤 프로그램이든 링크를 계산해 낼 수 있습니다. 링크를 누르면 그때 브라우저에서 보드가 열리고, 바로 이어서 편집할 수 있습니다.

- 필수 의존성이 없습니다. Node 18 이상과 최신 브라우저에서 동작합니다.
- **Node에서 PNG**를 만들 때만 선택 패키지 `@resvg/resvg-js`가 필요합니다. 이 폴더에서 `npm install`을 한 번 실행하면 설치됩니다. 브라우저에서는 필요 없습니다.
- 세 가지로 쓸 수 있습니다: JS 라이브러리, 명령줄 도구, AI 에이전트용 MCP 서버.

## 브라우저 앱과 같은 기능

| 앱에서 하는 일 | SDK | CLI | MCP |
|---|---|---|---|
| 도형 그리기·고치기·옮기기·지우기, 페이지 탭 추가·이름 변경·삭제·순서 | `Board` 메서드 | – | `edit_board` |
| 복제(`Ctrl+D`), 복사·잘라내기·붙여넣기, 전체 선택, 선택 도형 스타일 바꾸기 | `duplicate` `copy` `cut` `paste` `selectAll` `setStyle(…, {apply:true})` | – | `edit_board` |
| 실행취소·다시실행 | `undo` `redo` | – | `edit_board` |
| 화면 맞춤·카메라·도구 | `fit` `setCamera` `setTool` | – | `edit_board` |
| Share(링크) | `makeLink`, `board.getShareLink()` | `link` | `create_board_link`, `edit_board` |
| `.liteboard` 내보내기 | `toLiteboardFile`, `board.toLiteboardFile()` | `file … out.liteboard` | `save_board_file` |
| `.tldr` 내보내기 | `toTldrFile`, `board.toTldrFile()` | `file … out.tldr` | `save_board_file` |
| SVG / PNG 내보내기 | `toSvg` `toPng`, `board.toSvg()` `board.toPng()` | `file … out.svg` / `out.png` | `save_board_file`, `render_board_image` |
| 열기(`.liteboard`, `.tldr`), 공유 링크 열기 | `Board.fromText`, `Board.fromLink`, `readTldr`, `readLink` | `read`, 모든 명령의 입력 | `read_board`, `read_board_link`, `source` 인자 |

브라우저에서만 의미가 있는 것은 빠졌습니다. 시스템 클립보드에 링크 복사, 파일 다운로드 대화상자, 다크 모드, localStorage 자동 저장이 그렇습니다. SDK는 문자열이나 바이트를 돌려주거나 파일에 직접 씁니다.

## 1. 라이브러리

```js
import { makeLink, Board } from "./sdk/lite-board.mjs";
// 브라우저에서: import { makeLink, Board } from "https://sanghyun-io.github.io/lite-board/sdk/lite-board.mjs";

const url = await makeLink([
  { type: "rect", x: 0, y: 0, w: 200, h: 80, text: "로그인", style: { color: "blue", fill: "semi" } },
  { type: "arrow", start: { x: 200, y: 40 }, end: { x: 300, y: 40 } },
  { type: "rect", x: 300, y: 0, w: 200, h: 80, text: "대시보드" },
]);
// → "https://sanghyun-io.github.io/lite-board/#b=..."
```

### 한 번에 변환하는 함수

| 함수 | 설명 |
|---|---|
| `makeLink(board, {base?})` | `Promise<string>`. 공유 링크를 만듭니다. `base`를 주면 다른 주소(예: 로컬 `index.html`)로 엽니다. |
| `readLink(link)` | `Promise<doc>`. 링크 안의 보드를 `.liteboard` v2 객체로 풉니다. |
| `toLiteboardFile(board)` | `.liteboard` 파일 내용(JSON 문자열). 앱의 Open이나 끌어다 놓기로 엽니다. |
| `toTldrFile(board)` | `.tldr` 파일 내용(JSON 문자열). tldraw.com 캔버스에 끌어다 놓으면 열립니다. 모든 페이지를 담습니다. |
| `readTldr(textOrObject)` | `{doc, skipped}`. `.tldr`을 앱의 Open과 같은 규칙으로 변환합니다(아래 "tldr 가져오기"). |
| `toSvg(board, {page?, ids?})` | SVG 문자열. 기본은 현재 페이지 전체이고, 흰 배경입니다. 빈 페이지면 `null`. |
| `toPng(board, {page?, ids?, scale?})` | `Promise<Uint8Array>`(PNG 바이트). 기본 배율 2, 최대 8. |
| `makeDoc(board)` | 검사와 정리를 마친 `.liteboard` v2 객체. |
| `checkShape(shape)` | 도형 하나를 검사합니다. |

`board`로 받는 형식은 다음 중 하나입니다.
- 도형 배열 (한 페이지)
- `{shapes, name?}` (한 페이지)
- `{pages: [{name?, shapes}], current?}` (여러 페이지, 앱에서 시트 탭으로 보임)
- 이미 있는 `.liteboard` v1/v2 문서
- `.tldr` 파일 객체

입력이 잘못되면 어디가 왜 틀렸는지 알려 주는 `LiteBoardError`를 던집니다. 예: `liteBoard: shapes[2].style.color must be one of black, grey, …`

검사 규칙은 입력 종류에 따라 다릅니다.
- **새로 만드는 보드**(배열, `{shapes}`, `{pages}`): 앱의 `liteBoard.addShapes`처럼 엄격하게 검사합니다.
- **이미 있는 문서**(`app: "lite-board"`인 파일이나 링크 내용): 앱의 `loadDoc`과 같은 규칙을 씁니다. 예를 들어 빈 페이지 이름은 `Page N`이 되고, 범위를 벗어난 `current`는 첫 페이지가 됩니다.
- **파일 열기**(`Board.fromText`): 앱의 Open과 똑같이, 잘못된 도형은 건너뛰고 나머지를 엽니다.

### `Board`: 앱의 `window.liteBoard`를 그대로

`Board`는 문서 하나를 메모리에 들고 있으면서, 앱의 [`window.liteBoard` API](../API.md)와 **같은 이름, 같은 인자, 같은 규칙**의 메서드를 제공합니다. 바꾸는 호출 하나가 실행취소 한 단계이고, 다른 페이지를 고친 뒤 `undo()`를 하면 그 페이지로 이동하는 것까지 같습니다.

```js
const b = new Board();                       // 또는 new Board(board), Board.fromText(파일 내용), await Board.fromLink(링크)
const [login] = b.addShapes([{ type: "rect", x: 0, y: 0, text: "로그인" }]);
b.addPage("아이디어");
b.addShape({ type: "note", x: 0, y: 0, text: "할 일" });
b.switchPage(0);
b.updateShape(login, { style: { color: "blue" } });
b.duplicate([login]);
b.undo();

const link = await b.getShareLink();
fs.writeFileSync("board.liteboard", b.toLiteboardFile());
fs.writeFileSync("board.tldr", b.toTldrFile());
fs.writeFileSync("page.svg", b.toSvg());
fs.writeFileSync("page.png", await b.toPng());
```

API.md와 다른 점은 다음과 같습니다.

| 항목 | 앱(`window.liteBoard`) | SDK(`Board`) |
|---|---|---|
| `toPng()` | data URL | `Uint8Array`(PNG 바이트) |
| `getShareLink({base?})` | 지금 열린 주소 기준 | 기본은 공개 사이트, `base`로 바꿈 |
| `importText()` | 토스트를 띄움 | 결과 객체만 돌려줌 |
| 추가 | – | `toLiteboardFile()`, `toTldrFile({page?})`, `Board.fromText()`, `Board.fromLink()` |
| `fit()` | 실제 창 크기 | 가상 화면 `new Board(x, {width, height})`, 기본 1280×800 |
| 글자 너비 | 브라우저 글꼴로 측정 | 브라우저에서는 똑같이 측정. Node에서는 추정값이라 텍스트 도형 너비·줄바꿈이 조금 다를 수 있음(앱에서 열면 다시 측정) |

### 도형 형식

좌표는 페이지 단위(픽셀과 비슷)이고, 오른쪽이 +x, 아래쪽이 +y입니다. 앱이 열 때 전체가 보이도록 맞추므로 범위는 자유롭습니다. 배열 순서대로 그리며, 뒤에 있는 도형이 위에 그려집니다.

| 타입 | 필드 |
|---|---|
| `rect`, `ellipse` | `x, y, w?, h?, text?` (기본 100×100, text는 가운데 라벨) |
| `note` | `x, y, w?, h?, text?` (기본 200×200) |
| `text` | `x, y, text` (너비 자동. `wrap: true`와 `w`를 주면 줄바꿈) |
| `arrow`, `line` | `start: {x, y}, end: {x, y}` (화살촉은 end 쪽) |
| `draw` | `points: [[x, y], ...]` |

모든 도형에 `style: {color, fill, dash, size}`를 줄 수 있고, 생략한 항목은 기본값을 씁니다.

| 항목 | 기본값 | 값 |
|---|---|---|
| `color` | `black` | `black grey light-violet violet blue light-blue yellow orange green light-green light-red red` |
| `fill` | `none` | `none semi solid` |
| `dash` | `solid` | `solid draw dashed dotted` (`draw`는 손그림 느낌) |
| `size` | `m` | `s m l xl` |

### tldr 가져오기

앱의 Open과 같은 부분 지원입니다. `geo`(타원 계열은 ellipse, 그 외는 rect), `text`, `note`, `arrow`(바인딩·bend 무시), `line`(2점은 line, 3점 이상은 draw), `draw`/`highlight`를 변환합니다. 그룹·프레임 안의 도형은 페이지 좌표로 옮기고, 회전은 무시합니다. 이미지 등 지원하지 않는 도형은 건너뛰고 `skipped`로 개수를 알려 줍니다.

## 2. 명령줄

```sh
node sdk/cli.mjs link board.json                 # 링크 출력
node sdk/cli.mjs file board.json out.liteboard   # 확장자로 형식 결정: .liteboard .tldr .svg .png
node sdk/cli.mjs file "<링크>" out.tldr           # 링크 → tldraw 파일
node sdk/cli.mjs file in.tldr out.png --page 1 --scale 3
node sdk/cli.mjs read in.tldr                    # 무엇이든 .liteboard JSON으로
cat board.json | node sdk/cli.mjs link -         # 표준입력
```

입력(`<board>`)은 공유 링크, 파일(`.liteboard`, `.tldr`, 보드 `.json`), `-`(표준입력) 중 무엇이든 됩니다.

| 옵션 | 설명 |
|---|---|
| `--base <url>` | 링크가 다른 주소를 가리키게 합니다. |
| `--page <p>` | 한 페이지만(번호, id, 이름). `.svg`·`.png`는 생략하면 현재 페이지입니다. |
| `--scale <k>` | `.png` 배율(기본 2, 최대 8). |
| `--format <f>` | 확장자 대신 형식 지정(`liteboard tldr svg png`). |

링크가 32KB를 넘으면 일부 메신저에서 잘릴 수 있다는 경고를 표준오류로 출력합니다.

## 3. MCP 서버 (AI 에이전트용)

```sh
node sdk/cli.mjs mcp
```

표준입출력으로 동작하는 MCP 서버입니다. 도구 설명에 도형 형식과 배치 요령이 들어 있어서, 에이전트가 따로 문서를 보지 않아도 그릴 수 있습니다.

| 도구 | 하는 일 |
|---|---|
| `create_board_link` | 도형이나 페이지를 받아 보드 링크를 돌려줍니다. |
| `read_board_link` | 링크 안의 보드를 JSON(`{pages, current}`)으로 돌려줍니다. |
| `read_board` | 링크나 파일(`.liteboard`, `.tldr`, `.json`)을 읽어 `{pages, current, link}`로 돌려줍니다. |
| `save_board_file` | 새 보드(`shapes`/`pages`)나 기존 보드(`source`: 링크·파일)를 `.liteboard`, `.tldr`, `.svg`, `.png` 파일로 저장합니다. 이미 있는 파일은 `overwrite: true`일 때만 덮어씁니다. |
| `edit_board` | 기존 보드(또는 새 보드)에 앱 API와 같은 조작(`addShapes`, `updateShape`, `deletePage`, `undo` …)을 순서대로 실행하고 새 링크를 돌려줍니다. `save_to`로 파일 저장도 합니다. |
| `render_board_image` | 보드 한 페이지를 PNG 이미지로 돌려줍니다. 에이전트가 링크를 주기 전에 배치를 눈으로 확인할 때 씁니다. |

파일 경로는 절대 경로를 권장합니다. 상대 경로는 MCP 서버를 띄운 폴더 기준입니다.

MCP 프로토콜 버전 `2025-06-18`과 `2024-11-05`를 지원합니다.

Claude Code에 연결하는 예:

```sh
claude mcp add -s user lite-board -- node /절대/경로/lite-board/sdk/cli.mjs mcp
```

연결한 뒤 "회원가입 흐름을 다이어그램으로 그려서 링크 줘", "그걸 tldr 파일로 바탕화면에 저장해 줘"라고 하면 됩니다.

## 테스트

```sh
cd sdk && npm install   # PNG 테스트용 선택 패키지
node test.mjs
```
