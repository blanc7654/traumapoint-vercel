import { getTmapRoute } from "../../../lib/geo/tmapRoute.js";

export default async function handler(req, res) {
  console.log("📦 [traumapoint API] 함수 시작");

  if (req.method !== "POST") {
    console.warn("⚠️ [traumapoint API] POST 외 메서드 호출");
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  let traumaPoints;

  try {
    const response = await fetch(`${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/data/traumaPoints_within_9km.json`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} - ${response.statusText}`);
    }

    traumaPoints = await response.json();
    console.log("✅ traumaPoints JSON fetch 성공");

  } catch (err) {
    console.error("❌ traumaPoints JSON fetch 실패:", err);
    return res.status(500).json({ error: "traumaPoints 불러오기 실패", stack: err.stack });
  }
  console.log("✅ traumaPoints JSON fetch 성공");

  const GIL = {
    name: "길병원",
    lat: 37.452699,
    lon: 126.707105,
  };

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

  const { origin } = req.body;
  console.log("📍 요청 받은 origin =", origin);
  if (!origin || typeof origin.lat !== "number" || typeof origin.lon !== "number") {
    console.error("❌ 잘못된 origin 좌표:", origin);
    return res.status(400).json({ error: "Invalid origin (lat/lon required)" });
  }

  try {
    const now = new Date();
    const departurePlus1m = new Date(now.getTime() + 1 * 60 * 1000);
    const departurePlus15m = new Date(now.getTime() + 15 * 60 * 1000);

    const originPoint = { lat: origin.lat, lon: origin.lon, name: origin.name || "출발지" };

    const directRoute = await getTmapRoute(originPoint, GIL, departurePlus1m);
    if (!directRoute || typeof directRoute.duration !== "number") {
      console.error("❌ 길병원 직행 ETA 계산 실패");
      return res.status(500).json({ error: "길병원 직행 ETA 계산 실패" });
    }
    const directToGilETA = Math.round(directRoute.duration / 60);
    const directFallback = !!directRoute.fallback;
    if (directFallback) {
      console.warn(`⚠️ 길병원 직행 경로 fallback 감지됨`);
    }

    const eta119List = await Promise.all(
      traumaPoints.map(async (tp) => {
        const route = await getTmapRoute(originPoint, tp, departurePlus1m);
        const eta119 = Math.round(route.duration / 60);
        const fallback = !!route.fallback;

        if (eta119 >= directToGilETA) {
          console.log(`❌ [119필터] ${tp.name}: eta119(${eta119}) ≥ directToGilETA(${directToGilETA})`);
          return null;
        }

        if (fallback) {
          console.warn(`⚠️ [Fallback 감지] ${tp.name}: 실시간 교통 미반영`);
        }

        return { ...tp, eta119, fallback119: fallback };
      })
    );

    const withDocETA = await Promise.all(
      eta119List.filter(Boolean).map(async (tp) => {
        const route = await getTmapRoute(GIL, tp, departurePlus15m);
        const etaDocRaw = Math.round(route.duration / 60);
        const etaDoc = etaDocRaw + 15;

        if (tp.eta119 <= etaDoc) {
          console.log(`❌ [닥터카 ETA 필터] ${tp.name}: eta119(${tp.eta119}) ≤ etaDoc(${etaDoc})`);
          return null;
        }

        if (etaDocRaw > directToGilETA + 20) {
          console.log(`❌ [닥터카 Raw ETA 필터] ${tp.name}: etaDocRaw(${etaDocRaw}) > directToGilETA(${directToGilETA}) + 20`);
          return null;
        }

        if (route.fallback) {
          console.warn(`⚠️ [Fallback 감지] ${tp.name} (닥터카): 실시간 교통 미반영`);
        }

        return {
          ...tp,
          etaDoc,
          etaDocRaw,
          fallbackDoc: !!route.fallback
        };
      })
    );

    const withTpToGil = await Promise.all(
      withDocETA.filter(Boolean).map(async (tp) => {
        const tpToGilDeparture = new Date(now.getTime() + tp.eta119 * 60 * 1000);
        const route = await getTmapRoute(tp, GIL, tpToGilDeparture);
        const tptogilETA = Math.round(route.duration / 60);
        const totalTransfer = tp.eta119 + tptogilETA;

        if (totalTransfer > directToGilETA + 20) {
          console.log(`❌ [총 이송시간 필터] ${tp.name}: totalTransfer(${totalTransfer}) > directToGilETA(${directToGilETA}) + 20`);
          return null;
        }

        if (route.fallback) {
          console.warn(`⚠️ [Fallback 감지] ${tp.name} → 길병원: 실시간 교통 미반영`);
        }

        return {
          name: tp.name,
          lat: tp.lat,
          lon: tp.lon,
          address: tp.address,
          tel: tp.tel,
          eta119: tp.eta119,
          etaDoc: tp.etaDoc,
          etaDocRaw: tp.etaDocRaw,
          tptogilETA,
          totalTransfer,
          fallback119: tp.fallback119,
          fallbackDoc: tp.fallbackDoc,
          fallbackToGil: !!route.fallback
        };
      })
    );

    const finalList = withTpToGil.filter(Boolean);
    const column1 = groupAndSortByTotalTransfer(finalList);
    const column2 = groupAndSortByEta119(finalList, directToGilETA, 5);
    const column3 = groupAndSortByEta119(finalList, directToGilETA, 10);

    res.status(200).json({
      origin,
      directToGilETA,
      fallbackDirect: directFallback,
      recommendations: { column1, column2, column3 },
    });

    console.log("\n🧾 === 요약 콘솔 출력 ===");
    console.log(`📍 요청 origin = (${origin.lat}, ${origin.lon})`);
    console.log(`🚑 길병원 직행 ETA: ${directToGilETA}분 ${directFallback ? "(⚠️ fallback)" : ""}`);
    console.log(`\n[1단계] 119 ETA 필터`);
    console.log(`  ▸ 원본 TP 수: ${traumaPoints.length}`);
    console.log(`  ▸ 통과: ${eta119List.filter(Boolean).length}개`);
    console.log(`  ▸ 제외: ${traumaPoints.length - eta119List.filter(Boolean).length}개`);
    console.log(`\n[2단계] 닥터카 ETA 필터`);
    console.log(`  ▸ 통과: ${withDocETA.filter(Boolean).length}개`);
    console.log(`  ▸ 제외: ${eta119List.filter(Boolean).length - withDocETA.filter(Boolean).length}개`);
    console.log(`\n[3단계] 총 이송시간 필터`);
    console.log(`  ▸ 최종 통과: ${withTpToGil.filter(Boolean).length}개`);
    console.log(`  ▸ 제외: ${withDocETA.filter(Boolean).length - withTpToGil.filter(Boolean).length}개`);
    console.log(`\n🎯 최종 추천`);
    console.log(`  ▸ column1 safe: ${column1.safe.length}개, accurate: ${column1.accurate.length}개`);
    console.log(`  ▸ column2 safe: ${column2.safe.length}개, accurate: ${column2.accurate.length}개`);
    console.log(`  ▸ column3 safe: ${column3.safe.length}개, accurate: ${column3.accurate.length}개`);
    console.log("🧾 =====================\n");

  } catch (e) {
    console.error("🚨 Tmap 계산 실패:", e.stack || e.message);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
}
