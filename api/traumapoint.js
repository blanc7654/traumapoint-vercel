const APP_KEY = "15c28ebb75dda243548737ac615a5681";

async function getKakaoRoute(origin, destination) {
try {
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

if (!response.ok) {
      throw new Error(`API 오류: ${response.status} ${response.statusText}, 메시지: ${data?.msg || "없음"}`);
    }

  const route = data.routes?.[0]?.summary;
  if (!route) {
      throw new Error("경로 요약 정보 없음 (data.routes[0].summary 없음)");
    }

  return {
    duration: route.duration,
    distance: route.distance
  };
  } catch (err) {
    throw new Error(`getKakaoRoute 실패 (${origin.name || "출발지"} → ${destination.name || "도착지"}): ${err.message}`);
  }
}

async function getMultiDestinationsETA(origin, destinations) {
  const url = "https://apis-navi.kakaomobility.com/v1/api/navi-affiliate/destinations/directions100";
  const headers = {
    Authorization: "KakaoAK " + APP_KEY,
    "Content-Type": "application/json"
  };

  const body = {
    origin: {
      x: origin.lon.toString(),
      y: origin.lat.toString(),
      name: origin.name || "출발지"
    },
    destinations: destinations.map(tp => ({
      x: tp.lon.toString(),
      y: tp.lat.toString(),
      name: tp.name
    })),
    radius: 50000,  
    summary: true
  };

  console.log("📤 [디버깅] getMultiDestinationsETA 전송 body:", JSON.stringify(body, null, 2));

 try {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
      console.log("❌ [디버깅] 카카오 다중 목적지 응답 전체:", JSON.stringify(data, null, 2));
      throw new Error(`다중 목적지 API 오류: ${response.status} ${response.statusText}, 메시지: ${data?.msg || "없음"}`);
    }

    return data.routes;
  } catch (err) {
    console.log("❌ [디버깅] getMultiDestinationsETA 예외 발생:", err.message);
    throw err;
  }
}

async function getMultiOriginsETA(destination, origins) {
  const url = "https://apis-navi.kakaomobility.com/v1/api/navi-affiliate/origins/directions100";
  const headers = {
    Authorization: "KakaoAK " + APP_KEY,
    "Content-Type": "application/json"
  };

  const body = {
    origins: origins.map((tp, idx) => ({
      x: tp.lon.toString(),
      y: tp.lat.toString(),
      key: idx.toString()
    })),
    destination: {
      x: destination.lon.toString(),
      y: destination.lat.toString(),
      name: destination.name || "길병원"
    },
    radius: 50000,
    summary: true
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`다중 출발지 API 오류: ${response.status} ${response.statusText}, 메시지: ${data?.msg || "없음"}`);
  }

  return data.routes; // origins 순서대로 결과 반환
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  const { origin } = req.body;
  if (!origin || typeof origin.lat !== "number" || typeof origin.lon !== "number") {
    return res.status(400).json({ error: "Invalid origin (lat/lon required)" });
  }

  const GIL = { name: "길병원", lat: 37.452699, lon: 126.707105 };
  const logs = [];
  const logF = msg => {     logs.push(msg);     console.log(msg);  };

  try {
    const traumaRes = await fetch(`${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/data/traumaPoints_within_9km.json`);
    const traumaPoints = await traumaRes.json();
    logF(`📍 [2] traumaPoints 총 ${traumaPoints.length}개 로딩됨`);

    const directETA = await getKakaoRoute(origin, GIL);
    const directToGilETA = Math.round(directETA.duration / 60);
    logF(`📍 [1] directToGil 계산 완료: ${directToGilETA}분`);

let eta119List = [];
try {
  const multiETA = await getMultiDestinationsETA(origin, traumaPoints);
  eta119List = traumaPoints.map((tp, idx) => {
    const route = multiETA[idx];
    const eta119 = Math.round(route.summary.duration / 60);
    logF(`✅ [3] ${tp.name} 119ETA 계산 완료 (다중요청): ${eta119}분`);
    return { ...tp, eta119 };
  });
} catch (err) {
  logF(`❌ [3] 다중 목적지 119ETA 계산 실패: ${err.message}`);
  return res.status(500).json({ error: "119ETA 계산 실패", log: logs });
}

    const invalid119 = eta119List.filter(tp => tp && tp.eta119 >= directToGilETA);
    invalid119.forEach(tp => logF(`🚫 [4] ${tp.name} 탈락: 119ETA ${tp.eta119}분 ≥ 직행 ${directToGilETA}분`));
    const eta119Valid = eta119List.filter(tp => tp && tp.eta119 < directToGilETA);
    logF(`📍 [4] 119ETA ≥ 직행인 곳 ${invalid119.length}개 탈락 → 남은 ${eta119Valid.length}개`);

let withDocETA = [];
try {
  const withDocMultiETA = await getMultiDestinationsETA(GIL, eta119Valid);

  withDocETA = eta119Valid.map((tp, idx) => {
    const route = withDocMultiETA[idx];
    if (!route?.summary?.duration) {
      logF(`❌ [5] ${tp.name} 닥터카 ETA 요약 정보 없음`);
      return null;
    }
    const etaDoc = Math.round(route.summary.duration / 60) + 10; // 10분 지연 반영
    logF(`✅ [5] ${tp.name} 닥터카 ETA 계산 완료: ${etaDoc}분`);
    return { ...tp, etaDoc };
  });

} catch (err) {
  logF(`❌ [5] 닥터카 ETA 다중 목적지 계산 실패: ${err.message}`);
  return res.status(500).json({ error: "닥터카 ETA 계산 실패", log: logs });
}

    const invalidDoc = withDocETA.filter(tp => tp && tp.etaDoc >= tp.eta119);
    invalidDoc.forEach(tp => logF(`🚫 [6] ${tp.name} 탈락: 닥터카ETA ${tp.etaDoc}분 ≥ 119ETA ${tp.eta119}분`));
    const withDocValid = withDocETA.filter(tp => tp && tp.eta119 > tp.etaDoc);
    logF(`📍 [6] 닥터카 ETA ≥ 119ETA 인 곳 ${invalidDoc.length}개 탈락 → 남은 ${withDocValid.length}개`);

    withDocValid.forEach(tp => { tp.etaGap = tp.eta119 - tp.etaDoc; });

    const danger = withDocValid.filter(tp => tp.etaGap > 0 && tp.etaGap < 5);
    const accurate = withDocValid.filter(tp => tp.etaGap >= 5 && tp.etaGap < 10);
    const safe = withDocValid.filter(tp => tp.etaGap >= 10);
    logF(`📍 [7] danger ${danger.length}개, accurate ${accurate.length}개, safe ${safe.length}개 분류됨`);

let withTpToGil = [];
try {
  const multiTptoGil = await getMultiOriginsETA(GIL, withDocValid);

  withTpToGil = withDocValid.map((tp, idx) => {
    const route = multiTptoGil[idx];
    if (!route?.summary?.duration) {
      logF(`❌ [8] ${tp.name} TP→길병원 ETA 요약 정보 없음`);
      return null;
    }
    const tptogilETA = Math.round(route.summary.duration / 60);
    const totalTransferTime = tp.eta119 + tptogilETA;
    logF(`✅ [8] ${tp.name} TP→길병원 ETA: ${tptogilETA}분, 총이송: ${totalTransferTime}분`);
    return { ...tp, tptogilETA, totalTransferTime };
  });
} catch (err) {
  logF(`❌ [8] 다중출발 TP→길병원 ETA 계산 실패: ${err.message}`);
  return res.status(500).json({ error: "TP→길병원 ETA 계산 실패", log: logs });
}

    const invalidTotalTransfer = withTpToGil.filter(tp => tp && tp.totalTransferTime > directToGilETA + 20);
    invalidTotalTransfer.forEach(tp => logF(`🚫 [10] ${tp.name} 탈락: 총이송 ${tp.totalTransferTime}분 = 119ETA ${tp.eta119} + TP→길 ${tp.tptogilETA}분 > 직행 ${directToGilETA} + 20분`));
    const finalList = withTpToGil.filter(tp => tp && tp.totalTransferTime <= directToGilETA + 20);
    logF(`📍 [10] totalTransferTime - directToGil ≥ 20분인 ${invalidTotalTransfer.length}개 탈락 → 최종 ${finalList.length}개 생존`);

    logF(`📍 [11] 모든 필터링 완료`);

// 📊 column1: danger(2) + accurate(3) + safe(3), 각 그룹 내에서 totalTransferTime 짧은 순
const sortByTransferTime = group => group.slice().sort((a, b) => a.totalTransferTime - b.totalTransferTime);
const column1 = [
  ...sortByTransferTime(danger).slice(0, 2),
  ...sortByTransferTime(accurate).slice(0, 3),
  ...sortByTransferTime(safe).slice(0, 3)
];
logF(`📦 [12] column1 구성 완료: danger ${Math.min(2, danger.length)}개, accurate ${Math.min(3, accurate.length)}개, safe ${Math.min(3, safe.length)}개 → 총 ${column1.length}개`);

// 📊 column2: totalTransferTime - directToGilETA ≤ 5분 && 119ETA 짧은 순
const column2 = finalList
  .filter(tp => tp.totalTransferTime - directToGilETA <= 5)
  .sort((a, b) => a.eta119 - b.eta119);
logF(`📦 [13] column2 구성 완료: 총 ${column2.length}개 (직행보다 ≤5분 이내)`);


// 📊 column3: totalTransferTime - directToGilETA ≤ 10분 && 119ETA 짧은 순
const column3 = finalList
  .filter(tp => tp.totalTransferTime - directToGilETA <= 10)
  .sort((a, b) => a.eta119 - b.eta119);
logF(`📦 [14] column3 구성 완료: 총 ${column3.length}개 (직행보다 ≤10분 이내)`);

res.status(200).json({
  directToGilETA,
  column1,
  column2,
  column3,
  log: logs
});

  } catch (err) {
    console.error("🚨 전체 처리 실패:", err);
    res.status(500).json({ error: err.message, log: logs });
  }
}

