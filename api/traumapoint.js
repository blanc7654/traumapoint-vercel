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

  try {
    const traumaRes = await fetch(`${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/data/traumaPoints_within_9km.json`);
    const traumaPoints = await traumaRes.json();
    console.log(`2. TP 총 ${traumaPoints.length}개 로딩됨.`);

    const directETA = await getKakaoRoute(origin, GIL);
    const directToGilETA = Math.round(directETA.duration / 60);
    console.log(`1. directToGil 단일목적지로 계산 성공: ${directToGilETA}분.`);

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
    console.log(`3. origin→TP 모두 계산 성공.`);

    const eta119Valid = eta119List.filter(tp => tp && tp.eta119 < directToGilETA);
    console.log(`4. 119ETA ≥ directToGil ETA로 탈락 ${eta119List.length - eta119Valid.length}개 → ${eta119Valid.length}개 생존.`);

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
    console.log(`5. etadocRaw 계산 완료, 15분 지연 포함 → etaDoc 계산 완료.`);

    const withDocValid = withDocETA.filter(tp => tp && tp.eta119 > tp.etaDoc);
    console.log(`6. 119ETA ≤ etaDoc으로 탈락 ${withDocETA.length - withDocValid.length}개 → ${withDocValid.length}개 생존.`);

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
    console.log(`8. TP→길병원 다중출발지 계산 성공.`);

    const finalList = withTpToGil.filter(tp => tp && tp.totalTransferTime <= directToGilETA + 20);
    console.log(`10. totalTransferTime - directToGil ≥ 20분 초과로 탈락 ${withTpToGil.length - finalList.length}개 → ${finalList.length}개 최종 생존.`);

    console.log(`11. 🔍 모든 필터링 완료.`);

    finalList.forEach(tp => {
      tp.etaGap = tp.eta119 - tp.etaDoc;
    });

    const danger = finalList.filter(tp => tp.etaGap >= 3 && tp.etaGap < 5);
    const accurate = finalList.filter(tp => tp.etaGap >= 5 && tp.etaGap < 10);
    const safe = finalList.filter(tp => tp.etaGap >= 10);
    console.log(`7. ETA gap 기준 분류 → danger=${danger.length}, accurate=${accurate.length}, safe=${safe.length}`);

    const column1 = [...danger, ...accurate, ...safe]
      .sort((a, b) => a.totalTransferTime - b.totalTransferTime)
      .slice(0, 8);
    const c1Danger = column1.filter(tp => tp.etaGap >= 3 && tp.etaGap < 5).length;
    const c1Accurate = column1.filter(tp => tp.etaGap >= 5 && tp.etaGap < 10).length;
    const c1Safe = column1.filter(tp => tp.etaGap >= 10).length;
    console.log(`12. Column1 출력 → danger=${c1Danger}, accurate=${c1Accurate}, safe=${c1Safe}`);

    const column2 = finalList
      .filter(tp => tp.totalTransferTime - directToGilETA <= 5)
      .sort((a, b) => a.eta119 - b.eta119)
      .slice(0, 8);
    const c2Danger = column2.filter(tp => tp.etaGap >= 3 && tp.etaGap < 5).length;
    const c2Accurate = column2.filter(tp => tp.etaGap >= 5 && tp.etaGap < 10).length;
    const c2Safe = column2.filter(tp => tp.etaGap >= 10).length;
    console.log(`13. Column2 출력 → danger=${c2Danger}, accurate=${c2Accurate}, safe=${c2Safe}`);

    const column3 = finalList
      .filter(tp => tp.totalTransferTime - directToGilETA <= 10)
      .sort((a, b) => a.eta119 - b.eta119)
      .slice(0, 8);
    const c3Danger = column3.filter(tp => tp.etaGap >= 3 && tp.etaGap < 5).length;
    const c3Accurate = column3.filter(tp => tp.etaGap >= 5 && tp.etaGap < 10).length;
    const c3Safe = column3.filter(tp => tp.etaGap >= 10).length;
    console.log(`14. Column3 출력 → danger=${c3Danger}, accurate=${c3Accurate}, safe=${c3Safe}`);

    res.status(200).json({
      directToGilETA,
      column1,
      column2,
      column3
    });

  } catch (err) {
    console.error("🚨 전체 처리 실패:", err);
    res.status(500).json({ error: err.message });
  }
}
