// pages/api/traumapoint.js
const APP_KEY = "15c28ebb75dda243548737ac615a5681";

async function getKakaoRoute(origin, destination) {
  const url = new URL("https://apis-navi.kakaomobility.com/v1/directions");
  url.searchParams.set("origin", `${origin.lon},${origin.lat},name=${origin.name || "출발지"}`);
  url.searchParams.set("destination", `${destination.lon},${destination.lat},name=${destination.name || "도착지"}`);
  url.searchParams.set("priority", "RECOMMEND");
  url.searchParams.set("car_fuel", "GASOLINE");
  url.searchParams.set("car_hipass", "false");
  url.searchParams.set("summary", "true");

  const headers = {
    Authorization: "KakaoAK " + APP_KEY,
    "Content-Type": "application/json"
  };

  console.log("📡 요청: ", url.toString());

  const response = await fetch(url.toString(), { method: "GET", headers });
  const data = await response.json();

  console.log("📬 응답 요약: ", JSON.stringify(data.routes?.[0]?.summary));

  const route = data.routes?.[0]?.summary;
  if (!route) {
    console.error("❌ 경로 요약 정보 없음:", data);
    throw new Error(`경로 요약 정보 없음`);
  }
  return {
    duration: route.duration,
    distance: route.distance
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const { origin } = req.body;
  console.log("📍 받은 origin:", origin);

  if (!origin || typeof origin.lat !== "number" || typeof origin.lon !== "number") {
    console.error("❌ origin 포맷 오류:", origin);
    return res.status(400).json({ error: "Invalid origin (lat/lon required)" });
  }

  const GIL = { name: "길병원", lat: 37.452699, lon: 126.707105 };

  try {
    const traumaRes = await fetch(`${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/data/traumaPoints_within_9km.json`);
    const traumaPoints = await traumaRes.json();
    console.log(`✅ 총 traumaPoints 수: ${traumaPoints.length}`);

    const directETA = await getKakaoRoute(origin, GIL);
    const directToGilETA = Math.round(directETA.duration / 60);
    console.log("🛣️ directToGilETA:", directToGilETA, "분");

    const eta119List = await Promise.all(
      traumaPoints.map(async tp => {
        try {
          const eta = await getKakaoRoute(origin, tp);
          const eta119 = Math.round(eta.duration / 60);
          if (eta119 < directToGilETA) {
            return { ...tp, eta119 };
          } else {
            console.log(`⚠️ 탈락 (직행보다 늦음): ${tp.name}, eta119=${eta119}`);
            return null;
          }
        } catch (err) {
          console.error("❌ eta119 계산 실패:", tp.name, err.message);
          return null;
        }
      })
    );

    const eta119Valid = eta119List.filter(Boolean);
    console.log(`🧮 eta119 유효 지점 수: ${eta119Valid.length}`);

    const withDocETA = await Promise.all(
      eta119Valid.map(async tp => {
        try {
          const etaDocRaw = await getKakaoRoute(GIL, tp);
          const etaDoc = Math.round(etaDocRaw.duration / 60) + 15;
          if (tp.eta119 > etaDoc) {
            return { ...tp, etaDoc };
          } else {
            console.log(`⚠️ 탈락 (닥터카가 더 늦음): ${tp.name}, eta119=${tp.eta119}, etaDoc=${etaDoc}`);
            return null;
          }
        } catch (err) {
          console.error("❌ etaDoc 계산 실패:", tp.name, err.message);
          return null;
        }
      })
    );

    const withDocValid = withDocETA.filter(Boolean);
    console.log(`🧮 etaDoc 유효 지점 수: ${withDocValid.length}`);

    const withTpToGil = await Promise.all(
      withDocValid.map(async tp => {
        try {
          const etaToGil = await getKakaoRoute(tp, GIL);
          const tptogilETA = Math.round(etaToGil.duration / 60);
          const totalTransfer = tp.eta119 + tptogilETA;
          if (totalTransfer <= directToGilETA + 20) {
            return { ...tp, tptogilETA, totalTransfer };
          } else {
            console.log(`⚠️ 탈락 (총 이송시간 초과): ${tp.name}, total=${totalTransfer}`);
            return null;
          }
        } catch (err) {
          console.error("❌ tptogilETA 실패:", tp.name, err.message);
          return null;
        }
      })
    );

    const finalList = withTpToGil.filter(Boolean);
    console.log(`🎯 최종 추천 가능 지점 수: ${finalList.length}`);

    const safe = finalList.filter(tp => tp.eta119 - tp.etaDoc >= 10);
    const accurate = finalList.filter(tp => tp.eta119 - tp.etaDoc >= 5 && tp.eta119 - tp.etaDoc < 10);
    const risk = finalList.filter(tp => tp.eta119 - tp.etaDoc >= 3 && tp.eta119 - tp.etaDoc < 5);

    console.log(`📊 그룹별 분류: safe=${safe.length}, accurate=${accurate.length}, risk=${risk.length}`);

    res.status(200).json({
      origin,
      directToGilETA,
      recommendations: {
        column1: [...safe, ...accurate, ...risk],
        column2: [...accurate, ...risk],
        column3: [...risk]
      }
    });
  } catch (err) {
    console.error("🚨 전체 처리 실패:", err);
    res.status(500).json({ error: err.message });
  }
}
