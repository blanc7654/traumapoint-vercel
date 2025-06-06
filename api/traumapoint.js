// traumapoint.js (Vercel용 통합 버전)
const APP_KEY = "ff2XFiLWzU26CQBmdLzf44Dik9czqiWVao072nF1";

function formatToISO8601WithKST(date) {
  const pad = n => n.toString().padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);  // ⬅️ 여기는 +1이 맞습니다
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}+0900`;  // ⬅️ 여기도 수정 완료
}

async function getTmapRoute(origin, destination, apiKey, departureTime = new Date(), label = "") {
  const url = "https://apis.openapi.sk.com/tmap/routes/prediction?version=1&reqCoordType=WGS84GEO&resCoordType=WGS84GEO&sort=index";


  if (!origin || typeof origin.lat !== "number" || typeof origin.lon !== "number" ||
      !destination || typeof destination.lat !== "number" || typeof destination.lon !== "number") {
    console.error("❌ 좌표가 누락되었거나 잘못되었습니다:", { origin, destination });
    throw new Error("❌ 출발지 또는 도착지 좌표 누락");
  }

  if (!(departureTime instanceof Date)) {
    throw new Error("🚨 departureTime은 Date 객체로 명시적으로 전달해야 합니다.");
  }



  const predictionTime = formatToISO8601WithKST(new Date(departureTime.getTime() + 3 * 60000));

  const body = {
    routesInfo: {
departure: {
        name: origin.name || "출발지",
  lat: origin.lat.toString(),
  lon: origin.lon.toString(),
  depSearchFlag: origin.poiId ? "05" : "03",
  poiId: origin.poiId || undefined 
      },
      destination: {
        name: destination.name || "도착지",
        lon: destination.lon.toString(),
        lat: destination.lat.toString(),
        destSearchFlag: "03"
	},
      predictionType: "arrival",
      predictionTime,
      searchOption: "02",
      tollgateCarType: "car",
      trafficInfo: "Y",
      }
  };

  try {
    console.log("🔑 사용된 API KEY:", apiKey);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", appKey: apiKey },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    
    const summary = data.features?.find(f => f.properties?.totalTime);
    if (!summary) {
      console.error("📭 전체 응답 데이터:", JSON.stringify(data, null, 2));
      throw new Error(`[${origin.name} → ${destination.name}] 경로 요약 정보 없음`);
    }

const debug = data.features[0].properties;
console.log("🧪 routeType:", debug.routeType);
console.log("🧪 patternTrafficDate:", debug.patternTrafficDate);
console.log("🧪 realTimeTrafficDateTime:", debug.realTimeTrafficDateTime);
console.log("🧪 departureTime:", debug.departureTime);
console.log("🧪 trafficInfo:", debug.trafficInfo);

    const duration = summary.properties.totalTime;
    const distance = summary.properties.totalDistance;

    console.log("🚗 타임머신 응답 요약:", {
      from: origin.name,
      to: destination.name,
      predictionTime,
      totalTime: duration,
      totalDistance: distance
    });

    return { duration, distance };
  } catch (err) {
    console.error(`[${origin.name || "출발지"} → ${destination.name || "도착지"}] API 호출 실패: ${err.message}`);
    console.error("📛 STACK TRACE:", err.stack);
    throw err;
  }
}

export default async function handler(req, res) {
  console.log("📦 [traumapoint API] 함수 시작");

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (req.method !== "POST") {
    console.warn("⚠️ [traumapoint API] POST 외 메서드 호출");
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  let traumaPoints;
  try {
    const response = await fetch(`${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/data/traumaPoints_within_9km.json`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status} - ${response.statusText}`);
    traumaPoints = await response.json();
    console.log("✅ traumaPoints JSON fetch 성공");
  } catch (err) {
    console.error("❌ traumaPoints JSON fetch 실패:", err);
    return res.status(500).json({ error: "traumaPoints 불러오기 실패", stack: err.stack });
  }

  const GIL = { name: "길병원", lat: 37.452699, lon: 126.707105 };
  const { origin } = req.body;
  console.log("📍 요청 받은 origin =", origin);
  if (!origin || typeof origin.lat !== "number" || typeof origin.lon !== "number") {
    console.error("❌ 잘못된 origin 좌표:", origin);
    return res.status(400).json({ error: "Invalid origin (lat/lon required)" });
  }

  function groupAndSortByTotalTransfer(tpList) {
    const grouped = { safe: [], accurate: [] };
    tpList.forEach(tp => {
      const gain = tp.eta119 - tp.etaDoc;
      const entry = { ...tp };
      if (gain >= 10) grouped.safe.push(entry);
      else if (gain >= 5) grouped.accurate.push(entry);
    });
    grouped.safe = grouped.safe.sort((a, b) => a.totalTransfer - b.totalTransfer).slice(0, 10);
    grouped.accurate = grouped.accurate.sort((a, b) => a.totalTransfer - b.totalTransfer).slice(0, 5);
    return grouped;
  }

  function groupAndSortByEta119(tpList, directToGilETA, maxDelayMinutes) {
    const grouped = { safe: [], accurate: [] };
    tpList.filter(tp => tp.totalTransfer <= directToGilETA + maxDelayMinutes).forEach(tp => {
      const gain = tp.eta119 - tp.etaDoc;
      const entry = { ...tp };
      if (gain >= 10) grouped.safe.push(entry);
      else if (gain >= 5) grouped.accurate.push(entry);
    });
    grouped.safe = grouped.safe.sort((a, b) => a.eta119 - b.eta119).slice(0, 10);
    grouped.accurate = grouped.accurate.sort((a, b) => a.eta119 - b.eta119).slice(0, 5);
    return grouped;
  }

  try {
    const now = new Date();
	const safeFutureTime = new Date(now.getTime() + 3 * 60000); // 3분 후
	const predictionTime = formatToISO8601WithKST(safeFutureTime);

    const departurePlus5m = new Date(now.getTime() + 5 * 60000);
    const originPoint = { lat: origin.lat, lon: origin.lon, name: origin.name || "출발지" };

    const directRoute = await getTmapRoute(originPoint, GIL, APP_KEY, now);
    const directToGilETA = Math.round(directRoute.duration / 60);

    const eta119List = await Promise.all(
      traumaPoints.map(async (tp) => {
        const route = await getTmapRoute(originPoint, tp, APP_KEY, new Date());
        const eta119 = Math.round(route.duration / 60);
        if (eta119 >= directToGilETA) return null;
        return { ...tp, eta119 };
      })
    );

    const withDocETA = await Promise.all(
      eta119List.filter(Boolean).map(async (tp) => {
        const route = await getTmapRoute(GIL, tp, APP_KEY, departurePlus5m);
        const etaDocRaw = Math.round(route.duration / 60);
        const etaDoc = etaDocRaw + 5;
        if (tp.eta119 <= etaDoc || etaDocRaw > directToGilETA + 20) return null;
        return { ...tp, etaDoc, etaDocRaw };
      })
    );

    const withTpToGil = await Promise.all(
      withDocETA.filter(Boolean).map(async (tp) => {
        const depTime = new Date(now.getTime() + tp.eta119 * 60000);
        const route = await getTmapRoute(tp, GIL, APP_KEY, depTime);
        const tptogilETA = Math.round(route.duration / 60);
        const totalTransfer = tp.eta119 + tptogilETA;
        if (totalTransfer > directToGilETA + 20) return null;
        return { ...tp, tptogilETA, totalTransfer };
      })
    );

    const finalList = withTpToGil.filter(Boolean);
    const column1 = groupAndSortByTotalTransfer(finalList);
    const column2 = groupAndSortByEta119(finalList, directToGilETA, 5);
    const column3 = groupAndSortByEta119(finalList, directToGilETA, 10);

    res.status(200).json({ origin, directToGilETA, recommendations: { column1, column2, column3 } });

    console.log("\n🧾 === 요약 콘솔 출력 ===");
    console.log(`📍 요청 origin = (${origin.lat}, ${origin.lon})`);
    console.log(`🚑 길병원 직행 ETA: ${directToGilETA}분`);
    console.log(`\n[1단계] 119 ETA 필터 통과: ${eta119List.filter(Boolean).length}`);
    console.log(`\n[2단계] 닥터카 ETA 필터 통과: ${withDocETA.filter(Boolean).length}`);
    console.log(`\n[3단계] 총 이송시간 필터 통과: ${withTpToGil.filter(Boolean).length}`);
    console.log(`\n🎯 최종 추천 - column1.safe: ${column1.safe.length}, accurate: ${column1.accurate.length}`);
  } catch (e) {
    console.error("🚨 Tmap 계산 실패:", e.stack || e.message);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
}
