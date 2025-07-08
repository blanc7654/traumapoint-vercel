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
          return { ...tp, eta119 };
        } catch {
          return null;
        }
      })
    );
    logF(`📍 [3] origin → traumaPoints 경로 계산 완료`);

    const eta119Valid = eta119List.filter(tp => tp && tp.eta119 < directToGilETA);
    logF(`📍 [4] 119ETA ≥ 직행인 곳 ${eta119List.length - eta119Valid.length}개 탈락 → 남은 ${eta119Valid.length}개`);

    const withDocETA = await Promise.all(
      eta119Valid.map(async tp => {
        try {
          const etaDocRaw = await getKakaoRoute(GIL, tp);
          const etaDoc = Math.round(etaDocRaw.duration / 60) + 15;
          return { ...tp, etaDoc };
        } catch {
          return null;
        }
      })
    );
    logF(`📍 [5] 길병원 → traumaPoints 경로 계산 완료 (닥터카 ETA)`);

    const withDocValid = withDocETA.filter(tp => tp && tp.eta119 > tp.etaDoc);
    logF(`📍 [6] 닥터카 ETA ≥ 119ETA 인 곳 ${withDocETA.length - withDocValid.length}개 탈락 → 남은 ${withDocValid.length}개`);

    withDocValid.forEach(tp => {
      tp.etaGap = tp.eta119 - tp.etaDoc;
    });

    const danger = withDocValid.filter(tp => tp.etaGap >= 3 && tp.etaGap < 5);
    const accurate = withDocValid.filter(tp => tp.etaGap >= 5 && tp.etaGap < 10);
    const safe = withDocValid.filter(tp => tp.etaGap >= 10);
    logF(`📍 [7] danger ${danger.length}개, accurate ${accurate.length}개, safe ${safe.length}개 분류됨`);

    const withTpToGil = await Promise.all(
      withDocValid.map(async tp => {
        try {
          const etaToGil = await getKakaoRoute(tp, GIL);
          const tptogilETA = Math.round(etaToGil.duration / 60);
          const totalTransferTime = tp.eta119 + tptogilETA;
          return { ...tp, tptogilETA, totalTransferTime };
        } catch {
          return null;
        }
      })
    );
    logF(`📍 [8] traumaPoints → 길병원 경로 계산 완료`);

    const finalList = withTpToGil.filter(tp => tp && tp.totalTransferTime <= directToGilETA + 20);
    logF(`📍 [10] totalTransferTime - directToGil ≥ 20분인 ${withTpToGil.length - finalList.length}개 탈락 → 최종 ${finalList.length}개 생존`);

    logF(`📍 [11] 모든 필터링 완료`);

    finalList.forEach(tp => {
      tp.etaGap = tp.eta119 - tp.etaDoc;
    });

    const column1 = [...finalList]
      .filter(tp => tp.etaGap >= 3)
      .sort((a, b) => a.totalTransferTime - b.totalTransferTime)
      .slice(0, 8);
    const c1Danger = column1.filter(tp => tp.etaGap >= 3 && tp.etaGap < 5).length;
    const c1Accurate = column1.filter(tp => tp.etaGap >= 5 && tp.etaGap < 10).length;
    const c1Safe = column1.filter(tp => tp.etaGap >= 10).length;
    logF(`📍 [12] Column1: danger ${c1Danger}개, accurate ${c1Accurate}개, safe ${c1Safe}개`);

    const column2 = finalList
      .filter(tp => tp.totalTransferTime - directToGilETA <= 5)
      .sort((a, b) => a.eta119 - b.eta119)
      .slice(0, 8);
    const c2Danger = column2.filter(tp => tp.etaGap >= 3 && tp.etaGap < 5).length;
    const c2Accurate = column2.filter(tp => tp.etaGap >= 5 && tp.etaGap < 10).length;
    const c2Safe = column2.filter(tp => tp.etaGap >= 10).length;
    logF(`📍 [13] Column2: danger ${c2Danger}개, accurate ${c2Accurate}개, safe ${c2Safe}개`);

    const column3 = finalList
      .filter(tp => tp.totalTransferTime - directToGilETA <= 10)
      .sort((a, b) => a.eta119 - b.eta119)
      .slice(0, 8);
    const c3Danger = column3.filter(tp => tp.etaGap >= 3 && tp.etaGap < 5).length;
    const c3Accurate = column3.filter(tp => tp.etaGap >= 5 && tp.etaGap < 10).length;
    const c3Safe = column3.filter(tp => tp.etaGap >= 10).length;
    logF(`📍 [14] Column3: danger ${c3Danger}개, accurate ${c3Accurate}개, safe ${c3Safe}개`);

    res.status(200).json({
      directToGilETA,
      column1,
      column2,
      column3,
      log: logs // 👈 F12용 로그 함께 응답
    });

  } catch (err) {
    console.error("🚨 전체 처리 실패:", err);
    res.status(500).json({ error: err.message, log: logs });
  }
}
