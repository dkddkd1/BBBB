import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";
import type { SearchIntent } from "@/lib/types";

const PROMPT = `너는 한국 지도 검색어 해석기다. 사용자의 검색어에서 다음을 뽑아라.
- region: 네이버지도에서 구획(행정동·법정동·도로명·지명)으로 검색할 이름 하나. "근처", "주변", "에서" 같은 말은 뺀다. 예: "을지로 근처 한식집" → "을지로"
- keywords: 사용자가 원하는 음식 종류가 있으면, 식당의 업종·상호에 들어 있을 만한 짧은 단어들. 업종은 소상공인 상가정보 표기("중분류 > 소분류")를 따른다.
  중분류: 한식, 중식, 일식, 서양식, 동남아시아, 기타 외국식, 구내식당·뷔페, 기타 간이.
  소분류 예: 백반/한정식, 국/탕/찌개류, 냉면/밀면, 국수/칼국수, 돼지고기 구이/찜, 소고기 구이/찜, 횟집, 김밥/만두/분식, 치킨, 피자, 버거, 중국집, 일식 회/초밥, 라멘, 파스타/스테이크.
  예: 한식 → ["한식"], 고기집 → ["고기"], 분식 → ["분식","김밥"], 일식 → ["일식"]. 특정 종류를 말하지 않았으면 빈 배열.
- summary: 해석 결과를 한 줄로 (예: "을지로 · 한식 식당만").`;

const schema = {
  type: Type.OBJECT,
  properties: {
    region: { type: Type.STRING },
    keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
    summary: { type: Type.STRING },
  },
  required: ["region", "keywords", "summary"],
};

export async function POST(req: Request) {
  const { q } = (await req.json().catch(() => ({}))) as { q?: string };
  const query = (q ?? "").trim().slice(0, 100);
  if (!query) return NextResponse.json({ error: "검색어를 입력하세요" }, { status: 400 });

  // "연남동", "을지로"처럼 한 단어면 AI 없이 바로 구획 이름으로 쓴다
  if (!/\s/.test(query)) {
    return NextResponse.json({ region: query, keywords: [], summary: query } satisfies SearchIntent);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY가 설정되지 않아 자연어 검색을 할 수 없습니다. 지역 이름만 입력해 보세요." }, { status: 500 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: `${PROMPT}\n\n검색어: ${query}`,
      config: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
    });
    const intent = JSON.parse(res.text ?? "{}") as SearchIntent;
    if (!intent.region) throw new Error("지역을 찾지 못했습니다");
    intent.region = intent.region.replace(/\s+/g, "");
    intent.keywords = (intent.keywords ?? []).filter(Boolean).slice(0, 20);
    return NextResponse.json(intent);
  } catch (e) {
    return NextResponse.json({ error: `검색어 해석 실패: ${(e as Error).message}` }, { status: 502 });
  }
}
