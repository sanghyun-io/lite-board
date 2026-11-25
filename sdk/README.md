# lite-board SDK

브라우저 없이 lite-board 보드를 만듭니다. 도형 목록(JSON)을 넣으면 **공유 링크**나 **`.liteboard` 파일**이 나옵니다.

lite-board의 공유 링크는 `#b=` 뒤에 보드 전체를 압축해 담고, 서버에는 아무것도 저장하지 않습니다. 그래서 규칙만 알면 어떤 프로그램이든 링크를 계산해 낼 수 있습니다. 링크를 누르면 그때 브라우저에서 보드가 열리고, 바로 이어서 편집할 수 있습니다.

- 의존성이 없습니다. Node 18 이상과 최신 브라우저에서 동작합니다.
- 세 가지로 쓸 수 있습니다: JS 라이브러리, 명령줄 도구, AI 에이전트용 MCP 서버.

## 1. 라이브러리

```js
import { makeLink, toLiteboardFile, readLink } from "./sdk/lite-board.mjs";
// 브라우저에서: import { makeLink } from "https://sanghyun-io.github.io/lite-board/sdk/lite-board.mjs";

const url = await makeLink([
  { type: "rect", x: 0, y: 0, w: 200, h: 80, text: "로그인", style: { color: "blue", fill: "semi" } },
  { type: "arrow", start: { x: 200, y: 40 }, end: { x: 300, y: 40 } },
  { type: "rect", x: 300, y: 0, w: 200, h: 80, text: "대시보드" },
]);
// → "https://sanghyun-io.github.io/lite-board/#b=..."
```

| 함수 | 설명 |
|---|---|
| `makeLink(board, {base?})` | `Promise<string>`. 공유 링크를 만듭니다. `base`를 주면 다른 주소(예: 로컬 `index.html`)로 엽니다. |
| `toLiteboardFile(board)` | `.liteboard` 파일 내용(JSON 문자열)을 돌려줍니다. 앱의 Open이나 끌어다 놓기로 엽니다. |
| `readLink(link)` | `Promise<doc>`. 링크 안의 보드를 객체로 풉니다. 고쳐서 다시 `makeLink`에 넣을 수 있습니다. |
| `makeDoc(board)` | 검사와 정리를 마친 `.liteboard` v2 객체를 돌려줍니다. |
| `checkShape(shape)` | 도형 하나를 검사합니다. |

`board`로 받는 형식은 다음 넷 중 하나입니다.
- 도형 배열 (한 페이지)
- `{shapes, name?}` (한 페이지)
- `{pages: [{name?, shapes}], current?}` (여러 페이지, 앱에서 시트 탭으로 보임)
- 이미 있는 `.liteboard` v1/v2 문서

입력이 잘못되면 어디가 왜 틀렸는지 알려 주는 `LiteBoardError`를 던집니다. 예: `liteBoard: shapes[2].style.color must be one of black, grey, …`

검사 규칙은 입력 종류에 따라 다릅니다.
- **새로 만드는 보드**(배열, `{shapes}`, `{pages}`): 앱의 `liteBoard.addShapes`처럼 엄격하게 검사합니다.
- **이미 있는 문서**(`app: "lite-board"`인 파일이나 링크 내용): 앱의 `loadDoc`과 같은 규칙을 씁니다. 그래서 앱이 여는 것은 SDK도 모두 읽습니다. 예를 들어 빈 페이지 이름은 `Page N`이 되고, 범위를 벗어난 `current`는 첫 페이지가 됩니다.

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

자세한 규칙은 앱의 [API.md](../API.md)와 같습니다.

## 2. 명령줄

```sh
node sdk/cli.mjs link board.json          # 링크 출력
node sdk/cli.mjs file board.json out.liteboard
node sdk/cli.mjs read "<링크>"             # 링크 안의 보드를 JSON으로
cat board.json | node sdk/cli.mjs link -  # 표준입력
```

`--base <url>`을 붙이면 링크가 다른 주소를 가리킵니다. 링크가 32KB를 넘으면 일부 메신저에서 잘릴 수 있다는 경고를 표준오류로 출력합니다.

## 3. MCP 서버 (AI 에이전트용)

```sh
node sdk/cli.mjs mcp
```

표준입출력으로 동작하는 MCP 서버이고, 도구 두 개를 제공합니다.

- `create_board_link`: 도형이나 페이지를 받아 보드 링크를 돌려줍니다. 도구 설명에 도형 형식과 배치 요령이 들어 있어서, 에이전트가 따로 문서를 보지 않아도 그릴 수 있습니다.
- `read_board_link`: 링크 안의 보드를 JSON(`{pages, current}`)으로 돌려줍니다. 기존 보드를 고쳐 새 링크를 만들 때 씁니다.

MCP 프로토콜 버전 `2025-06-18`과 `2024-11-05`를 지원합니다.

Claude Code에 연결하는 예:

```sh
claude mcp add lite-board -- node /절대/경로/lite-board/sdk/cli.mjs mcp
```

연결한 뒤 "회원가입 흐름을 다이어그램으로 그려서 링크 줘"라고 하면, 에이전트가 링크를 만들어 답합니다.

## 테스트

```sh
node sdk/test.mjs
```
