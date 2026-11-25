# lite-board 스펙

tldraw.com과 같은 장르(무한 캔버스 화이트보드)의 **아주 가벼운** 독자 구현. tldraw의 이름·로고·아이콘·UI 디자인·코드는 복제하지 않는다. `.tldr` 파일 가져오기는 상호운용 목적의 기능으로만 지원한다.

## 제약
- `index.html` 단일 파일. 바닐라 JS + SVG 렌더링. 외부 의존성·빌드 단계 없음. 목표 크기 ≤ 70KB.
- 데스크톱 마우스/트랙패드 우선, 포인터 이벤트로 터치/펜도 기본 동작.
- 라이트/다크 자동(prefers-color-scheme). 독자적인 미니멀 UI (상단 중앙 툴바, 우측 스타일 패널, 좌상단 메뉴).

## 기능
1. **도구** (단축키): Select `V`, Hand `H`, Draw `D`, Eraser `E`, Arrow `A`, Line `L`, Text `T`, Note `N`, Rectangle `R`, Ellipse `O`.
2. **스타일**: 색 12개(`black, grey, light-violet, violet, blue, light-blue, yellow, orange, green, light-green, light-red, red`, 색 값은 자체 팔레트), fill `none/semi/solid`, dash `draw/dashed/dotted/solid`(draw는 약간 흔들리는 손그림 느낌 또는 solid로 대체 가능), size `s/m/l/xl`. 선택된 도형에 적용, 없으면 다음 도형 기본값.
3. **캔버스**: 무한 팬(휠 스크롤, Space+드래그, Hand 도구, 가운데 버튼), 줌(Ctrl/⌘+휠, 핀치, `+`/`-`/`0`(100%)/`Shift+1`(전체 맞춤)), 줌 % 표시.
4. **편집**: 클릭 선택, Shift 다중 선택, 빈 곳 드래그 마퀴 선택, 이동, 8방향 핸들 리사이즈(사각형/타원/노트/텍스트/draw는 스케일), 화살표·선은 양 끝점 핸들, 텍스트·노트 더블클릭 편집, Delete/Backspace 삭제, `Ctrl+D` 복제, `Ctrl+A` 전체 선택, `Ctrl+Z`/`Ctrl+Shift+Z`(또는 `Ctrl+Y`) 실행취소/다시실행, 복사/붙여넣기(`Ctrl+C/V`, 앱 내부 클립보드면 충분), Esc로 선택 해제.
5. **지속성**: localStorage 자동 저장(디바운스), 새로고침 시 복원. 메뉴에 "새 문서(전체 지우기)".
6. **Export**: 
   - 자체 포맷 (`.liteboard`, 내용은 JSON, MIME `application/vnd.liteboard+json`) — 아래 스키마. 메뉴 이름은 "Export .liteboard".
   - SVG — 현재 도형 전체(선택이 있으면 선택만), 여백 포함, 배경 포함 옵션은 불필요(흰 배경 고정 가능).
   - PNG — SVG를 캔버스로 래스터라이즈 (2x 배율).
7. **Import**: 메뉴의 "열기" 버튼(파일 선택) + 캔버스로 파일 드래그앤드롭. 
   - 자체 포맷(`.liteboard`; 하위 호환으로 `.json`도 허용): 현재 문서를 대체(실행취소 가능). 파일 선택 accept는 `.liteboard,.json,.tldr`.
   - `.tldr`: 아래 매핑으로 변환해 대체. 지원 안 되는 레코드는 건너뛰고 "N개 도형을 가져왔고 M개는 지원하지 않아 건너뜀" 토스트.
   - 이미지 파일(png/jpg/svg) 드롭은 선택 사항(하지 않아도 됨).
   - 잘못된 파일은 alert() 쓰지 말고 토스트로 오류 표시.

## 자체 포맷 `.liteboard` 스키마 (v1)
```json
{ "app": "lite-board", "version": 1,
  "camera": {"x":0,"y":0,"z":1},
  "shapes": [
    {"id":"s_xxx","type":"rect|ellipse|draw|arrow|line|text|note",
     "x":0,"y":0,"w":100,"h":80,            // rect/ellipse/note/text 박스(페이지 좌표)
     "points":[[x,y],...],                  // draw: 페이지 좌표 절대값 또는 x,y 기준 상대값 중 하나로 일관되게
     "start":{"x":0,"y":0},"end":{"x":0,"y":0}, // arrow/line (페이지 좌표)
     "text":"",
     "style":{"color":"black","fill":"none","dash":"draw","size":"m"}}
  ] }
```
필드는 타입별로 필요한 것만 넣는다. 그릴 순서 = 배열 순서.

## `.tldr` 포맷 (REA로 tldraw.com 번들에서 확인한 근거)
- 파일: 확장자 `.tldr`, MIME `application/vnd.tldraw+json`. 최상위 `{tldrawFileFormatVersion: 1, schema: {schemaVersion: 1|2, ...}, records: [{id, typeName, ...}]}`. `document.version`만 있는 구버전(v1) 파일은 "지원하지 않는 구버전" 오류로 처리.
- 레코드 `typeName`: `document`, `page`, `shape`, `binding`, `asset`, `camera`, `instance` 등. 도형은 `typeName:"shape"`이며 공통 필드 `id`("shape:..."), `type`, `x`, `y`, `rotation`(라디안), `index`(정렬 키 문자열 — 문자열 비교로 정렬), `parentId`(`page:...` 또는 `shape:...` 그룹/프레임), `opacity`, `props`.
- 여러 페이지가 있으면 모든 페이지를 `index` 순서로 가져온다(아래 "여러 페이지" 참고). 부모가 그룹/프레임인 도형은 부모의 x,y를 누적해 페이지 좌표로 변환(회전은 무시해도 됨).
- 스타일 enum: color `black, grey, light-violet, violet, blue, light-blue, yellow, orange, green, light-green, light-red, red, white`, fill `none, semi, solid, pattern, fill, lined-fill`(none/semi/solid 외는 solid로), dash `draw, solid, dashed, dotted`, size `s, m, l, xl`. props.scale가 있으면 크기에 곱한다.
- `geo`: props `{geo, w, h, growY, color, fill, dash, size, richText, ...}`. `geo:"ellipse"|"oval"` → ellipse, 나머지(rectangle, triangle, diamond, star, cloud …) → rect. 높이는 `h + growY`. richText 라벨이 있으면 무시하거나 rect의 text로 넣어도 됨.
- `text`: props `{richText, color, size, scale, w, autoSize, textAlign}` → text.
- `note`: props `{richText, color, size, growY, scale}` → note (tldraw 노트 기본 크기 200×200, +growY).
- `arrow`: props `{start:{x,y}, end:{x,y}, bend, arrowheadStart, arrowheadEnd, color, dash, size, richText}`. start/end는 도형 로컬 좌표 → 페이지 좌표 = (shape.x + start.x, shape.y + start.y). 바인딩은 무시(저장된 start/end 좌표 사용). bend는 무시해도 됨.
- `line`: props `{points: {[id]: {id, index, x, y}}, color, dash, size, spline, scale}` → `index`로 정렬한 점들. 2점이면 line, 3점 이상이면 draw(폴리라인)로 변환.
- `draw` / `highlight`: props `{segments:[{type:"free"|"straight", path, dim?}], color, fill, dash, size, isClosed, scale, scaleX, scaleY}`.
  `path`는 base64. 디코딩(번들에서 확인한 로직):
  ```js
  // dim===2: [float32 x, float32 y] + (n-1) * [float16 dx, float16 dy]   (little-endian)
  // 그 외(3D): [float32 x, float32 y, float32 z] + (n-1) * [float16 dx, float16 dy, float16 dz]
  function decodePath(b64, dim) {
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const dv = new DataView(u8.buffer); const pts = [];
    let x = dv.getFloat32(0, true), y = dv.getFloat32(4, true);
    const head = dim === 2 ? 8 : 12, step = dim === 2 ? 4 : 6;
    pts.push([x, y]);
    for (let o = head; o + 4 <= u8.length; o += step) { x += f16(dv.getUint16(o, true)); y += f16(dv.getUint16(o + 2, true)); pts.push([x, y]); }
    return pts;
  }
  function f16(h) { const s = h >> 15, e = (h >> 10) & 31, m = h & 1023;
    if (e === 0) return (s ? -1 : 1) * m * 2 ** -24;
    if (e === 31) return m ? NaN : (s ? -Infinity : Infinity);
    return (s ? -1 : 1) * 2 ** (e - 15) * (1 + m / 1024); }
  ```
  점들은 도형 로컬 좌표 → (x*scaleX + shape.x, y*scaleY + shape.y). 구형 파일에서 segment에 `points: [{x,y,z}]` 배열이 직접 있으면 그대로 사용. 모든 segment 점을 이어 하나의 draw로.
- richText(TipTap): `{type:"doc", content:[{type:"paragraph", content:[{type:"text", text:"..."}]}, ...]}` → 문단을 `\n`으로 이어 평문. 구버전 props.text 문자열이 있으면 그것을 사용.
- 그 외(`image`, `video`, `frame`, `group`, `embed`, `bookmark` 등)는 건너뜀(그룹/프레임은 자식 좌표 계산에만 사용).

## 비목표
멀티플레이어, 로그인, 회전, 이미지/미디어, 화살표 바인딩. (링크 공유와 여러 페이지는 아래 추가 기능으로 지원)

## 추가: 여러 페이지(시트 탭)
- 문서 = 순서 있는 페이지 목록 `{id, name, shapes, camera}` + 현재 페이지 id. 편집·선택·실행취소·자동 저장·맞춤·지우개·클립보드는 현재 페이지 기준. 페이지마다 카메라를 따로 유지.
- 화면 하단(좌하단 실행취소/줌 패널 오른쪽)에 스프레드시트식 탭 줄: 클릭 이동, 더블클릭 이름 변경, `+` 추가(`Page N`), `×` 삭제(마지막 한 장은 불가), 드래그로 순서 변경, `Alt+PageDown/PageUp`(또는 `Ctrl+PageDown/PageUp`) 이동. 탭이 많으면 가로 스크롤.
- 페이지 추가·삭제·이름 변경·순서 변경과 모든 페이지의 도형 편집은 실행취소 대상. 다른 페이지의 편집을 되돌리면 그 페이지로 이동. 페이지 이동은 실행취소 단계가 아님.
- `.liteboard` v2: `{app:"lite-board", version:2, current:<pageId>, pages:[{id,name,camera,shapes}]}`. v1(단일 `shapes`)은 `Page 1` 한 장으로 읽음. localStorage 자동 저장도 v2(기존 v1 값은 로드 시 변환).
- `.tldr` 가져오기는 모든 페이지(`index` 순), 내보내기는 모든 페이지를 `page:<n>` 레코드로. 공유 링크는 모든 페이지를 담고 v1 링크도 해석. SVG/PNG는 현재 페이지(또는 선택)만.

## 추가: 스크립트 API (`window.liteBoard` v1)
- 자동화 도구·AI 에이전트가 페이지에서 JS로 보드를 조작하도록 공개 API를 둔다. 명세는 `API.md`.
- JSON 입출력(항상 복사본), 변경 호출 1회 = 실행취소 1단계, 잘못된 입력은 보드를 바꾸지 않고 `Error('liteBoard: ...')`, 다운로드·클립보드·토스트 없음(`importText` 제외).
- 테스트 전용 `window.__board`는 이 API로 대체한다. 이 기능으로 파일 크기가 목표(70KB)를 조금 넘을 수 있다.

## 추가: `.tldr` 내보내기
tldraw.com에서 저장한 실제 파일(`samples/tldraw-real.tldr`)의 `schema`와 도형별 props를 그대로 따라 만든다. 선택이 있으면 선택한 도형만 내보낸다.
