let selectedPlace = null;

window.onload = function () {
  const waitForKakao = setInterval(() => {
    if (window.kakao && window.kakao.maps && typeof kakao.maps.load === "function") {
      clearInterval(waitForKakao);
      kakao.maps.load(initApp);
    }
  }, 100);
};

function initApp() {
  // ✅ 자동완성 이벤트 연결
  document.getElementById('startInput').addEventListener('input', handleAutocomplete);
  document.getElementById('searchBtn').addEventListener('click', findTraumapoint);
  document.getElementById('currentLocationBtn')?.addEventListener('click', handleCurrentLocation);

  const params = new URLSearchParams(window.location.search);
  const lat = parseFloat(params.get('lat'));
  const lon = parseFloat(params.get('lon'));
  if (lat && lon) {
    const origin = { lat, lon };
    showMarker(origin);
    requestRecommendation(origin);
  }
}

function handleAutocomplete(e) {
  const keyword = e.target.value;
  const box = document.getElementById('suggestions');
  box.innerHTML = '';
  if (!keyword.trim()) return;

  fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}`, {
    headers: { Authorization: "KakaoAK 15c28ebb75dda243548737ac615a5681" }
  })
    .then(res => res.json())
    .then(data => {
      data.documents.slice(0, 5).forEach(p => {
        const div = document.createElement('div');
        div.textContent = p.place_name;
        div.addEventListener('click', () => {
          selectedPlace = { lat: parseFloat(p.y), lon: parseFloat(p.x), name: p.place_name };
          document.getElementById('startInput').value = p.place_name;
          box.innerHTML = '';
          showMarker(selectedPlace);
        });
        box.appendChild(div);
      });
    });
}

function findTraumapoint() {
  if (!selectedPlace) return alert("장소를 먼저 선택하세요.");
  requestRecommendation(selectedPlace);
}

function handleCurrentLocation() {
  if (!navigator.geolocation) return alert("GPS를 지원하지 않습니다.");
  navigator.geolocation.getCurrentPosition(
    pos => {
      const origin = {
        lat: parseFloat(pos.coords.latitude.toFixed(7)),
        lon: parseFloat(pos.coords.longitude.toFixed(7))
      };
      showMarker(origin);
      requestRecommendation(origin);
    },
    err => {
      alert("위치 정보를 가져올 수 없습니다.");
    }
  );
}

function requestRecommendation(origin) {
  fetch("/api/traumapoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin })
  })
    .then(res => res.json())
    .then(data => showResults(data.recommendations, origin, data.directToGilETA))
    .catch(err => alert("실패: " + err.message));
}

function showMarker(coord) {
  const container = document.getElementById('map');
  container.innerHTML = '';
  const map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(coord.lat, coord.lon),
    level: 3
  });
  new kakao.maps.Marker({
    map: map,
    position: new kakao.maps.LatLng(coord.lat, coord.lon)
  });
}

function showResults(groups, origin, directToGilETA) {
  console.log("📦 추천 결과:", groups);
}
