export async function getTmapRoute(origin, destination, departureTime = new Date()) {
  const apiKey = process.env.TMAP_APP_KEY;
  console.log("🔑 Loaded API Key:", apiKey ? "OK" : "MISSING");
  const url = "https://apis.openapi.sk.com/tmap/routes";

  // 🛑 좌표 유효성 검사
  if (
    !origin || typeof origin.lat !== "number" || typeof origin.lon !== "number" ||
    !destination || typeof destination.lat !== "number" || typeof destination.lon !== "number"
  ) {
    console.error("❌ 좌표가 누락되었거나 잘못되었습니다:", { origin, destination });
    throw new Error("❌ 출발지 또는 도착지 좌표 누락");
  }

  // ✅ 출발 시각 ISO-8601 +0900 포맷
  if (!(departureTime instanceof Date)) {
    throw new Error("🚨 departureTime은 Date 객체로 명시적으로 전달해야 합니다.");
  }

  function formatToISO8601WithKST(date) {
    const pad = n => n.toString().padStart(2, '0');
    const yyyy = date.getFullYear();
    const MM = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    return `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}+0900`;
  }

  const predictionTime = formatToISO8601WithKST(departureTime);

  const body = {
    routesInfo: {
      departure: {
        name: origin.name || "출발지",
        lon: origin.lon.toString(),
        lat: origin.lat.toString(),
        depSearchFlag: "03"
      },
      destination: {
        name: destination.name || "도착지",
        lon: destination.lon.toString(),
        lat: destination.lat.toString(),
        destSearchFlag: "03"
      },
      predictionType: "departure",
      predictionTime,
      searchOption: "02",
      tollgateCarType: "car",
      trafficInfo: "Y"
    }
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "appKey": apiKey
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
// ✅ 추가 로그
console.log("📦 Tmap API 응답 원본:", JSON.stringify(data, null, 2));
console.log("📤 요청 바디:", JSON.stringify(body, null, 2));

    const summary = data.features?.find(f => f.properties?.totalTime);

  if (!summary) {
  console.error("📭 전체 응답 데이터:", JSON.stringify(data, null, 2));
  throw new Error(`[${origin.name} → ${destination.name}] 경로 요약 정보 없음`);
}

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
}  catch (err) {
  console.error(`[${origin.name || "출발지"} → ${destination.name || "도착지"}] API 호출 실패: ${err.message}`);
  console.error("📛 STACK TRACE:", err.stack);
  throw err;
}