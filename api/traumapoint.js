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
  if (!route) throw new Error("경로 요약 정보 없음");

  return {
    duration: route.duration,
    distance: route.distance
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  const { origin } = req.body;
  if (!origin || typeof origin.lat !== "number" || typeof origin.lon !== "number") {
    return res.status(400).json({ error: "Invalid origin (lat/lon required)" });
  }

  const GIL = { name: "길병원", lat: 37.452699, lon: 126.707105 };
  const logs = [];

  const logF = msg => {
    logs.push(msg);
    console.log(msg);
  };

  try {
    const traumaRes = await fetch(`${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/data/traumaPoints_within_9km.json`);
    const traumaPoints = await traumaRes.json();
    logF(`📍 [2] traumaPoints 총 ${traumaPoints.length}개 로딩됨`);

    const directETA = await getKakaoRoute(origin, GIL);
    const directToGilETA = Math.round(directETA.duration / 60);
    logF(`📍 [1] directToGil 계산 완료: ${directToGilETA}분`);

    const eta119List = await Promise.all(
      traumaPoints.map(async tp => {
        try {
          const eta = await getKakaoRoute(origin, tp);
          const eta119 = Math.round(eta.duration / 60);
          logF(`✅ [3] ${tp.name} 119ETA 계산 완료: ${eta119}분`);
          return { ...tp, eta119 };
        } catch {
          logF(`❌ [3] ${tp?.name || "이름없음"} 119ETA 계산 실패 (null)`);
          return null;
        }
      })
    );

    const invalid119 = eta119List.filter(tp => tp && tp.eta119 >= directToGilETA);
    invalid119.forEach(tp => logF(`🚫 [4] ${tp.name} 탈락: 119ETA ${tp.eta119}분 ≥ 직행 ${directToGilETA}분`));
    const eta119Valid = eta119List.filter(tp => tp && tp.eta119 < directToGilETA);
    logF(`📍 [4] 119ETA ≥ 직행인 곳 ${invalid119.length}개 탈락 → 남은 ${eta119Valid.length}개`);

    const withDocETA = await Promise.all(
      eta119Valid.map(async tp => {
        try {
          const etaDocRaw = await getKakaoRoute(GIL, tp);
          const etaDoc = Math.round(etaDocRaw.duration / 60) + 10;
          logF(`✅ [5] ${tp.name} 닥터카 ETA 계산 완료: ${etaDoc}분`);
          return { ...tp, etaDoc };
        } catch {
          logF(`❌ [5] ${tp?.name || "이름없음"} 닥터카 ETA 계산 실패 (null)`);
          return null;
        }
      })
    );

    const invalidDoc = withDocETA.filter(tp => tp && tp.etaDoc >= tp.eta119);
    invalidDoc.forEach(tp => logF(`🚫 [6] ${tp.name} 탈락: 닥터카ETA ${tp.etaDoc}분 ≥ 119ETA ${tp.eta119}분`));
    const withDocValid = withDocETA.filter(tp => tp && tp.eta119 > tp.etaDoc);
    logF(`📍 [6] 닥터카 ETA ≥ 119ETA 인 곳 ${invalidDoc.length}개 탈락 → 남은 ${withDocValid.length}개`);

    withDocValid.forEach(tp => { tp.etaGap = tp.eta119 - tp.etaDoc; });

    const danger = withDocValid.filter(tp => tp.etaGap > 0 && tp.etaGap < 5);
    const accurate = withDocValid.filter(tp => tp.etaGap >= 5 && tp.etaGap < 10);
    const safe = withDocValid.filter(tp => tp.etaGap >= 10);
    logF(`📍 [7] danger ${danger.length}개, accurate ${accurate.length}개, safe ${safe.length}개 분류됨`);

    const withTpToGil = await Promise.all(
      withDocValid.map(async tp => {
        try {
          const etaToGil = await getKakaoRoute(tp, GIL);
          const tptogilETA = Math.round(etaToGil.duration / 60);
          const totalTransferTime = tp.eta119 + tptogilETA;
          logF(`✅ [8] ${tp.name} TP→길병원 ETA: ${tptogilETA}분, 총이송: ${totalTransferTime}분`);
          return { ...tp, tptogilETA, totalTransferTime };
        } catch {
          logF(`❌ [8] ${tp?.name || "이름없음"} TP→길병원 ETA 계산 실패 (null)`);
          return null;
        }
      })
    );

    const invalidTotalTransfer = withTpToGil.filter(tp => tp && tp.totalTransferTime > directToGilETA + 20);
    invalidTotalTransfer.forEach(tp => logF(`🚫 [10] ${tp.name} 탈락: 총이송 ${tp.totalTransferTime}분 = 119ETA ${tp.eta119} + TP→길 ${tp.tptogilETA}분 > 직행 ${directToGilETA} + 20분`));
    const finalList = withTpToGil.filter(tp => tp && tp.totalTransferTime <= directToGilETA + 20);
    logF(`📍 [10] totalTransferTime - directToGil ≥ 20분인 ${invalidTotalTransfer.length}개 탈락 → 최종 ${finalList.length}개 생존`);

    logF(`📍 [11] 모든 필터링 완료`);

    res.status(200).json({
      directToGilETA,
      column1: finalList,
      column2: finalList,
      column3: finalList,
      log: logs
    });

  } catch (err) {
    console.error("🚨 전체 처리 실패:", err);
    res.status(500).json({ error: err.message, log: logs });
  }
}

