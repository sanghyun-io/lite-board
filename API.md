# lite-board 스크립트 API (`window.liteBoard` v1)

lite-board 페이지는 `window.liteBoard` 객체를 공개합니다. Playwright, Puppeteer, CDP, 브라우저 확장, AI 에이전트의 브라우저 도구처럼 **페이지에서 JavaScript를 실행할 수 있는 도구라면 무엇이든** 화면을 클릭하지 않고 보드를 읽고 고칠 수 있습니다.

```js
// Playwright 예시
await page.goto("https://sanghyun-io.github.io/lite-board/");
await page.waitForFunction(() => window.liteBoard);
const ids = await page.evaluate(() => liteBoard.addShapes([
  { type: "rect", x: 0, y: 0, w: 220, h: 90, text: "로그인", style: { color: "blue", fill: "semi" } },
  { type: "rect", x: 360, y: 0, w: 220, h: 90, text: "대시보드" },
  { type: "arrow", start: { x: 220, y: 45 }, end: { x: 360, y: 45 } },
]));
await page.evaluate(() => liteBoard.fit());
const link = await page.evaluate(() => liteBoard.getShareLink());
```

페이지에 `<meta name="lite-board-api">`가 있어서, 에이전트는 이 태그로 API가 있다는 것을 알 수 있습니다.

## 규칙

- **입력과 출력은 일반 JSON**입니다. 그래서 `page.evaluate` 경계를 그대로 넘나듭니다. 돌려주는 값은 항상 복사본이므로, 고쳐도 보드에 영향이 없습니다.
- **바꾸는 호출 한 번이 실행취소(`Ctrl+Z`) 한 단계**입니다. 예를 들어 `addShapes`로 도형 10개를 넣으면 한 번에 되돌아갑니다.
- **잘못된 입력은 오류를 던집니다.** 메시지는 `liteBoard: shapes[2].style.color must be one of black, grey, …`처럼 어디가 왜 틀렸는지 알려 줍니다. 오류가 나면 보드는 바뀌지 않습니다.
- 바뀐 내용은 화면에 바로 그려지고, 자동 저장(localStorage)도 평소처럼 됩니다.
- **읽기 호출**(`get*`, `pages`, `to*`, `getShareLink` 등)은 사람이 하던 일을 방해하지 않습니다.
- **바꾸는 호출**은 사람이 열어 둔 텍스트 편집이나 탭 이름 변경을 먼저 확정하고, 진행 중인 드래그를 끝냅니다.
- `{page}`로 다른 페이지를 고친 뒤 `undo()`/`redo()`를 하면, 변경이 보이도록 그 페이지로 이동합니다(앱의 `Ctrl+Z`와 같음).
- 다운로드, 클립보드, 토스트를 일으키지 않습니다. `importText`만 예외로, 앱의 가져오기 동작을 그대로 따르므로 토스트를 띄웁니다.
- 좌표는 모두 **페이지 좌표**입니다. 카메라나 줌과 상관없고, 화면 픽셀이 아닙니다.
- `liteBoard.version`(`"1.0.0"`)이 바뀌지 않는 한 아래 동작을 깨지 않습니다. 호환되지 않는 변경이 생기면 메이저 버전을 올립니다.

### 페이지 지정 (`page`)

페이지를 받는 메서드는 다음 셋 중 아무거나 받습니다. 생략하면 현재 페이지입니다.

| 값 | 의미 |
|---|---|
| `"p_xxx"` | 페이지 id |
| `0`, `1`, … | 탭 순서상의 위치 |
| `"Ideas"` | 페이지 이름 (id와 겹치지 않을 때, 같은 이름이 여럿이면 첫 번째) |

## 도형

```ts
type Shape =
  | { type: "rect" | "ellipse" | "note" | "text", x, y, w?, h?, text?, wrap?, style? }
  | { type: "arrow" | "line", start: {x, y}, end: {x, y}, style? }
  | { type: "draw", points: [x, y][], style? }      // 점은 {x, y}도 받음
// 공통: id?(문자열; 생략하거나 이미 있으면 새로 발급), text?(문자열)
type Style = { color?, fill?, dash?, size? }       // 생략한 항목은 기본값 black / none / solid / m
```

- `w`, `h`는 생략할 수 있습니다. 기본값은 100×100이고, note만 200×200입니다.
- `text` 타입은 `text`가 비어 있으면 안 됩니다. 너비는 글자에 맞춰 자동으로 정해집니다. `wrap: true`이면 `w` 너비에서 줄바꿈합니다.
- rect, ellipse의 `text`는 도형 가운데에 라벨로 표시됩니다.
- 쓸 수 있는 값 목록은 `liteBoard.schema`에 있습니다.

| 키 | 값 |
|---|---|
| `types` | `rect ellipse draw arrow line text note` |
| `colors` | `black grey light-violet violet blue light-blue yellow orange green light-green light-red red` |
| `fills` | `none semi solid` |
| `dashes` | `solid draw dashed dotted` (`draw`는 손그림 느낌) |
| `sizes` | `s m l xl` |
| `tools` | `select hand draw eraser arrow line text note rect ellipse` |

## 메서드

### 문서

| 메서드 | 반환 | 설명 |
|---|---|---|
| `getDoc()` | `.liteboard` v2 객체 | 문서 전체(모든 페이지). `.liteboard` 파일 내용과 같습니다. |
| `loadDoc(doc, {fit?})` | `{pages, shapes}` | v1/v2 객체로 문서를 통째로 바꿉니다. 모든 페이지와 도형을 `addShapes`와 같은 규칙으로 검사합니다. 하나라도 틀리면 오류를 던지고 아무것도 바꾸지 않습니다. `getDoc()` 결과는 항상 그대로 다시 넣을 수 있습니다. 기본으로 파일 열기처럼 여유 있게 화면을 맞추며(도형이 화면의 약 75%, 최대 100% 배율), `fit:false`이면 맞추지 않습니다. |
| `newDoc()` | 페이지 정보 | 빈 `Page 1` 한 장으로 시작합니다. |
| `importText(text, filename?)` | `{ok, imported?, skipped?, pages?, error?}` | `.liteboard`나 `.tldr` 파일 내용(문자열)을 앱의 "열기"와 똑같이 가져옵니다. 이 메서드만 실패해도 던지지 않고 `ok:false`를 돌려줍니다. |

### 페이지

페이지 정보의 형식은 `{id, name, index, count, current}`입니다.

| 메서드 | 반환 | 설명 |
|---|---|---|
| `pages()` | 페이지 정보[] | 탭 순서대로 |
| `currentPage()` | 페이지 정보 | |
| `addPage(name?, {activate?})` | 페이지 정보 | 끝에 추가합니다. 이름을 생략하면 `Page N`입니다. 기본으로 그 페이지로 이동하며, `activate:false`이면 이동하지 않습니다. |
| `switchPage(page)` | 페이지 정보 | 이동 자체는 실행취소 단계가 아닙니다. |
| `renamePage(page, name)` | 페이지 정보 | 빈 이름은 오류입니다. 최대 60자입니다. |
| `deletePage(page)` | 페이지 정보[] | 마지막 한 장은 지울 수 없습니다(오류). |
| `movePage(page, index)` | 페이지 정보[] | 탭 순서를 바꿉니다. |

### 도형

`{page}`를 넘기면 현재 페이지가 아닌 페이지도 화면 이동 없이 고칠 수 있습니다.

| 메서드 | 반환 | 설명 |
|---|---|---|
| `getShapes({page?})` | Shape[] | 그리는 순서(뒤가 위) |
| `getShape(id)` | Shape \| `null` | 모든 페이지에서 찾습니다. |
| `addShapes(shapes, {page?, select?})` | id[] | 하나라도 잘못되면 아무것도 추가하지 않고 오류를 던집니다. `select:true`이면 추가한 도형을 선택합니다(현재 페이지일 때). |
| `addShape(shape, opts?)` | id | |
| `updateShape(id, patch)` | Shape | 얕은 병합입니다. `style`은 항목별로 병합합니다. 타입은 바꿀 수 없습니다. `points`, `start`, `end`는 통째로 바뀝니다. 결과가 같으면 실행취소 단계를 만들지 않습니다. |
| `moveShapes(ids, dx, dy)` | 옮긴 수 | 모든 타입을 평행 이동합니다. |
| `deleteShapes(ids)` | 지운 수 | id 하나 또는 배열을 받습니다. 없는 id는 무시합니다. |
| `clearPage(page?)` | 지운 수 | |
| `duplicate(ids?, {offset?})` | 새 id[] | `Ctrl+D`. 도형을 복제해 같은 페이지에 `offset`(기본 16)만큼 비켜 놓습니다. 생략하면 선택한 도형입니다. 현재 페이지면 복제본을 선택합니다. |
| `copy(ids?)` / `cut(ids?)` | 복사한 수 | `Ctrl+C` / `Ctrl+X`. 앱 내부 클립보드에 넣습니다(키보드와 같은 클립보드). 생략하면 선택한 도형입니다. |
| `paste({page?})` | 새 id[] | `Ctrl+V`. 붙여넣을 때마다 16씩 더 비켜 놓습니다. |

### 선택·화면·도구 (현재 페이지)

| 메서드 | 반환 | 설명 |
|---|---|---|
| `getSelection()` / `select(ids)` | id[] | 현재 페이지에 있는 id만 선택됩니다. `select([])`는 선택을 해제합니다. |
| `selectAll()` | id[] | `Ctrl+A`. |
| `getCamera()` / `setCamera({x?, y?, z?})` | `{x, y, z}` | 화면 좌표 = 페이지 좌표 × z + (x, y). z는 0.1~8로 제한됩니다. |
| `fit()` | 카메라 | 현재 페이지 도형 전체에 맞춥니다. |
| `getTool()` / `setTool(name)` | 도구 이름 | 사람이 이어서 그릴 도구를 고릅니다. |
| `getStyle()` / `setStyle(style, {apply?})` | Style | 사람이 다음에 그릴 도형의 기본 스타일입니다. API로 추가하는 도형에는 영향이 없습니다. `apply:true`이면 스타일 패널처럼 선택한 도형에도 적용합니다(실행취소 한 단계). |

### 실행취소

| 메서드 | 반환 |
|---|---|
| `undo()` / `redo()` | 되돌린(다시 한) 단계가 있었으면 `true` |

### 내보내기

| 메서드 | 반환 | 설명 |
|---|---|---|
| `toTldr({page?})` | `.tldr` 객체 | 기본은 모든 페이지입니다. |
| `toSvg({page?, ids?})` | 문자열 \| `null` | 선택 상태와 상관없이 지정한 페이지(기본은 현재 페이지)의 도형 전체, 또는 `ids`만 내보냅니다. 흰 배경입니다. |
| `toPng({page?, ids?, scale?})` | `Promise<data URL \| null>` | 기본 배율은 2이고, 최대 8입니다. 잘못된 인자는 Promise를 reject합니다. |
| `getShareLink()` | `Promise<string>` | `#b=` 공유 링크를 만듭니다. 클립보드에는 복사하지 않습니다. 링크를 짧게 하려고 도형·페이지 id를 빼므로, 링크를 열면 id가 새로 발급됩니다. |
| `decodeShareLink(link)` | `Promise<doc>` | 링크 안의 보드를 객체로 풉니다. 열려면 `loadDoc(await liteBoard.decodeShareLink(url))`처럼 씁니다. 링크가 손상되었으면 `liteBoard:` 오류로 reject합니다. |

## 브라우저 없이

같은 API를 Node나 다른 페이지에서 브라우저 없이 쓰려면 [SDK의 `Board`](sdk/README.md)를 쓰세요. 메서드 이름과 규칙이 같고, `.liteboard`·`.tldr`·SVG·PNG 파일과 공유 링크를 직접 만듭니다.

## 참고

- 회전, 화살표 연결(바인딩), 이미지, 변경 이벤트 구독은 아직 없습니다.
- 공유 링크를 열면서 페이지가 로드될 때는 링크를 비동기로 풉니다. 바로 API를 호출하면 그 뒤에 공유 보드가 문서를 덮어쓸 수 있으니, 공유 링크를 열 때는 잠시 기다리거나 `decodeShareLink` + `loadDoc`을 쓰세요.
