console.log("📦 앱 시작됨 - 버전: 20250606");

let map;
let selectedPlace = null;
let tmapKey = 'ff2XFiLWzU26CQBmdLzf44Dik9czqiWVao072nF1';

window.onload = function () {
  map = new Tmapv2.Map("map", {
    center: new Tmapv2.LatLng(37.5665, 126.978),
    width: "100%",
    height: "400px",
    zoom: 12
  });

  fetch('/data/traumaPoints_within_9km.json?v=20250606')
    .then(res => res.json())
    .then(data => {
      console.log("✅ traumaPoints loaded:", data);
    })
    .catch(err => {
      console.error("❌ traumaPoints 불러오기 실패:", err);
    });

  document.getElementById('searchBtn').addEventListener('click', findTraumapoint);
  document.getElementById('startInput').addEventListener('input', handleAutocomplete);

  document.getElementById('currentLocationBtn')?.addEventListener('click', () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const origin = {
            lat: parseFloat(pos.coords.latitude.toFixed(7)),
            lon: parseFloat(pos.coords.longitude.toFixed(7))
          };
          console.log("📍 현재 위치 좌표:", origin);

          new Tmapv2.Marker({
            position: new Tmapv2.LatLng(origin.lat, origin.lon),
            map: map,
            title: "현재 위치"
          });

          map.setCenter(new Tmapv2.LatLng(origin.lat, origin.lon));
          requestRecommendation(origin);
        },
        err => {
          console.error("❌ 위치 정보 오류:", err.message);
          alert("❌ 위치 정보를 가져올 수 없습니다.");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      alert("❌ 이 브라우저는 위치 정보를 지원하지 않습니다.");
    }
  });

  const container = document.getElementById('carouselContainer');
  const indicator = document.getElementById('slideIndicator');
  const dot = document.getElementById('dotIndicator');

  container?.addEventListener('scroll', () => {
    const width = container.offsetWidth;
    const scrollLeft = container.scrollLeft;
    const pageIndex = Math.round(scrollLeft / width) + 1;
    indicator.textContent = `${pageIndex} / 3`;
    dot.textContent = ['● ○ ○', '○ ● ○', '○ ○ ●'][pageIndex - 1] || '● ○ ○';
  });

  const params = new URLSearchParams(window.location.search);
  const lat = parseFloat(params.get('lat'));
  const lon = parseFloat(params.get('lon'));
  if (lat && lon) {
    const origin = { lat, lon };
    requestRecommendation(origin);
  }
};

function handleAutocomplete(e) {
  const keyword = e.target.value;
  const suggestionsBox = document.getElementById('suggestions');
  suggestionsBox.innerHTML = '';

  if (!keyword.trim()) return;

  fetch(`https://apis.openapi.sk.com/tmap/pois?version=1&searchKeyword=${encodeURIComponent(keyword)}&appKey=${tmapKey}&v=${Date.now()}`, {
  cache: 'no-store', 
  headers: {
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  }
})
    .then(async res => {
      if (!res.ok) throw new Error("Tmap 응답 실패");
      const text = await res.text();
      if (!text) throw new Error("응답 없음");
      return JSON.parse(text);
    })
    .then(data => {
      const pois = data.searchPoiInfo?.pois?.poi || [];
      pois.slice(0, 5).forEach(poi => {
        const div = document.createElement('div');
        div.textContent = poi.name;
        div.addEventListener('click', () => {
          document.getElementById('startInput').value = poi.name;
          selectedPlace = {
  lat: parseFloat(poi.frontLat),
  lon: parseFloat(poi.frontLon),
  name: poi.name,
  poiId: poi.id
            };
          suggestionsBox.innerHTML = '';
        });
        suggestionsBox.appendChild(div);
      });
    })
    .catch(err => {
      console.error("자동완성 실패:", err.message);
    });
}

function findTraumapoint() {
  const suggestionsBox = document.getElementById('suggestions');
  suggestionsBox.innerHTML = '';

  if (!selectedPlace) {
    alert("자동완성 목록에서 장소를 먼저 선택해주세요.");
    return;
  }

  new Tmapv2.Marker({
    position: new Tmapv2.LatLng(selectedPlace.lat, selectedPlace.lon),
    map: map,
    title: "선택한 위치"
  });

  map.setCenter(new Tmapv2.LatLng(selectedPlace.lat, selectedPlace.lon));
  requestRecommendation(selectedPlace);
}

function showLoading() {
  const loadingDiv = document.getElementById('loading');
  if (loadingDiv) loadingDiv.style.display = 'block';
}

function hideLoading() {
  const loadingDiv = document.getElementById('loading');
  if (loadingDiv) loadingDiv.style.display = 'none';
}

function requestRecommendation(origin) {
  showLoading();

  fetch(`/api/traumapoint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store', // ✅ 캐시 무시
    body: JSON.stringify({ origin })
  })
    .then(async res => {
      console.log("🔍 API 상태코드:", res.status);
      const text = await res.text();
      console.log("🔍 응답 내용:", text);
      if (!res.ok) throw new Error("API 실패");
      return JSON.parse(text);
    })
    .then(data => {
      hideLoading();
      showResults(data.recommendations, origin, data.directToGilETA);
    })
    .catch(err => {
      hideLoading();
      console.error("🚨 API 호출 실패:", err.message);
      alert("추천 실패. 다시 시도해주세요.");
    });
}

function showResults(groups, origin, directToGilETA) {
  ['col1', 'col2', 'col3'].forEach((colId, index) => {
    const col = document.getElementById(colId);
    if (col) col.innerHTML = '';
  });

  let totalShown = false;

  ["column1", "column2", "column3"].forEach((colName, idx) => {
    const group = groups[colName];
    const colId = `col${idx + 1}`;
    const colContainer = document.getElementById(colId);
    if (!group || !colContainer) return;

    const label =
      idx === 0
        ? "✅ 총 이송 시간 짧은 순"
        : idx === 1
        ? "⏱️ 빠른 닥터카 접촉 순 (직행 대비 ≤ 5분 지연)"
        : "⏱️ 빠른 닥터카 접촉 순 (직행 대비 ≤ 10분 지연)";

    ["safe", "accurate"].forEach(subgroup => {
      const list = group[subgroup];
      if (!list || list.length === 0) return;

      totalShown = true;
      const section = document.createElement('div');
      section.innerHTML = `<h3>${label} - ${subgroup.toUpperCase()} 인계지점</h3>`;

      list.forEach(tp => {
        const gain = tp.eta119 - tp.etaDoc;
        const fallbackText = (tp.fallback119 || tp.fallbackDoc || tp.fallbackToGil)
          ? `<li style="color: #d97706; font-weight: bold;">⚠️ 실시간 교통 미반영 (Fallback 발생)</li>`
          : '';

        const item = document.createElement('div');
        item.className = 'hospital';
        item.style = 'padding:10px; border:1px solid #ccc; margin-bottom:10px;';
        item.innerHTML = `
          <h4>🏥 ${tp.name}</h4>
          <ul>
            <li><b>📍 주소: ${tp.address ?? '주소 없음'}</b></li>
	    <li>📞 전화번호: ${tp.tel ?? '정보 없음'}</li>  
            <li><b>119 ETA(의사접촉시간): ${tp.eta119}분</b></li>
            <li>🚑 닥터카 ETA: ${tp.etaDoc}분 → ${gain}분 빠름</li>
            <li>➡️ 인계 후 길병원까지: ${tp.tptogilETA}분</li>
            <li><b style="color:red;">총 이송 시간: ${tp.totalTransfer}분</b></li>
            <li>🚨 길병원 직접 이송 시 ETA: ${directToGilETA ?? 'N/A'}분</li>
            ${fallbackText}
          </ul>
        `;
        section.appendChild(item);
      });

      colContainer.appendChild(section);
    });
  });

  if (!totalShown) {
    const result = document.getElementById('col1');
    result.innerHTML = '<p>❌ 추천할만한 인계지점이 없습니다.</p>';
  } else {
    const shareUrl = `?lat=${origin.lat}&lon=${origin.lon}`;
    const shareDiv = document.createElement('div');
    shareDiv.innerHTML = `
      <p>
        <a href="#" onclick="navigator.clipboard.writeText('${shareUrl}'); alert('📎 링크 복사됨: ${shareUrl}'); return false;">
          🔗 결과 공유하기
        </a>
      </p>
    `;
    document.getElementById('col1').appendChild(shareDiv);
  }
}
