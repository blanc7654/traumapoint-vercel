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

  const response = await fetch(url.toString(), { method: "GET", headers });
  const data = await response.json();

  const route = data.routes?.[0]?.summary;
  if (!route) throw new Error(`경로 요약 정보 없음`);
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
  if (!origin || typeof origin.lat !== "number" || typeof origin.lon !== "number") {
    return res.status(400).json({ error: "Invalid origin (lat/lon required)" });
  }

  const GIL = { name: "길병원", lat: 37.452699, lon: 126.707105 };

  try {
    const traumaRes = await fetch(`${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/data/traumaPoints_within_9km.json`);
    const traumaPoints = await traumaRes.json();

    const directETA = await getKakaoRoute(origin, GIL);
    const directToGilETA = Math.round(directETA.duration / 60);

    const eta119List = await Promise.all(
      traumaPoints.map(async tp => {
        const eta = await getKakaoRoute(origin, tp);
        const eta119 = Math.round(eta.duration / 60);
        return eta119 < directToGilETA ? { ...tp, eta119 } : null;
      })
    );

    const withDocETA = await Promise.all(
      eta119List.filter(Boolean).map(async tp => {
        const etaDocRaw = await getKakaoRoute(GIL, tp);
        const etaDoc = Math.round(etaDocRaw.duration / 60) + 15;
        return tp.eta119 <= etaDoc ? null : { ...tp, etaDoc };
      })
    );

    const withTpToGil = await Promise.all(
      withDocETA.filter(Boolean).map(async tp => {
        const etaToGil = await getKakaoRoute(tp, GIL);
        const tptogilETA = Math.round(etaToGil.duration / 60);
        const totalTransfer = tp.eta119 + tptogilETA;
        return totalTransfer <= directToGilETA + 20 ? { ...tp, tptogilETA, totalTransfer } : null;
      })
    );

    const finalList = withTpToGil.filter(Boolean);
    const safe = finalList.filter(tp => tp.eta119 - tp.etaDoc >= 10);
    const accurate = finalList.filter(tp => tp.eta119 - tp.etaDoc >= 5 && tp.eta119 - tp.etaDoc < 10);

    res.status(200).json({
      origin,
      directToGilETA,
      recommendations: {
        column1: { safe, accurate },
        column2: { safe, accurate },
        column3: { safe, accurate }
      }
    });
  } catch (err) {
    console.error("🚨 처리 실패:", err);
    res.status(500).json({ error: err.message });
  }
}