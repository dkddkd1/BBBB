// aside 브라우저 에이전트로 네이버지도에서 구획 경계 폴리곤을 가져온다.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ASIDE_BIN = process.env.ASIDE_BIN || "aside";
const TIMEOUT_MS = Number(process.env.ASIDE_TIMEOUT_MS || 10 * 60 * 1000);
const DEBUG_DIR = path.join(import.meta.dirname, "debug");

const BEGIN = "<<<BPLPAY_JSON";
const END = "BPLPAY_JSON>>>";

function buildPrompt(name) {
  const url = `https://map.naver.com/p/search/${encodeURIComponent(name)}`;
  return [
    `네이버지도(${url})에서 "${name}"을 검색했을 때 지도에 표시되는 구획(행정동·법정동·지명)의 경계 폴리곤 좌표를 가져와줘.`,
    `페이지가 받아오는 네트워크 응답(경계·폴리곤·geometry 데이터)에서 좌표를 그대로 가져와. 눈으로 짐작한 좌표는 쓰지 마.`,
    `좌표가 WGS84(경도, 위도)가 아니면 WGS84로 바꿔줘. 같은 이름의 구획이 여러 개면 검색 결과 첫 번째 것을 써.`,
    `결제·로그인·메시지 전송 같은 동작은 하지 마. 읽기만 해.`,
    `마지막 답변에 아래 형식의 JSON을 ${BEGIN} 와 ${END} 사이에 정확히 한 번 출력해줘. 다른 설명은 그 바깥에 써.`,
    `${BEGIN}`,
    `{"displayName":"네이버지도에 표시된 정식 구획 이름 (예: 서울 마포구 연남동)","polygon":{"type":"Polygon","coordinates":[[[경도,위도],...]]},"center":{"lat":0,"lng":0}}`,
    `${END}`,
    `폴리곤을 끝내 찾지 못하면 "polygon": null 로 둬.`,
  ].join("\n");
}

function run(args) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    // Windows의 .cmd 래퍼는 셸 없이 실행할 수 없다
    const useShell = isWin && !/\.exe$/i.test(ASIDE_BIN);
    const quoted = useShell ? args.map((a) => `"${a.replace(/"/g, "'").replace(/\r?\n/g, " ")}"`) : args;
    const child = spawn(ASIDE_BIN, quoted, { shell: useShell, windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`aside 시간 초과 (${TIMEOUT_MS / 60000}분)`));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      out += d;
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`aside 실행 실패: ${e.message}. aside CLI가 설치되어 있는지 확인하세요.`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.includes(BEGIN)) reject(new Error(`aside 종료 코드 ${code}: ${err.slice(-500)}`));
      else resolve(out);
    });
  });
}

export function parseAsideOutput(text) {
  const start = text.lastIndexOf(BEGIN);
  const end = text.indexOf(END, start);
  if (start === -1 || end === -1) throw new Error("aside 응답에서 JSON을 찾지 못했습니다");
  const raw = text.slice(start + BEGIN.length, end).trim().replace(/^```(?:json)?|```$/g, "").trim();
  const data = JSON.parse(raw);
  const poly = data.polygon;
  const polygon = poly && ["Polygon", "MultiPolygon"].includes(poly.type) && Array.isArray(poly.coordinates) ? poly : null;
  return {
    displayName: data.displayName ? String(data.displayName) : null,
    polygon,
    center: data.center && Number.isFinite(data.center.lat) ? data.center : null,
  };
}

/** 네이버지도에서 구획 경계를 가져온다 → { displayName, polygon, center } */
export async function fetchBoundaryWithAside(name) {
  const out = await run([buildPrompt(name)]);
  await mkdir(DEBUG_DIR, { recursive: true });
  await writeFile(path.join(DEBUG_DIR, `${name}-${Date.now()}.txt`), out);
  return parseAsideOutput(out);
}
