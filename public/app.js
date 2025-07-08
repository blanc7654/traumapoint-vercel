let selectedPlace = null;

window.onload = function () {
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
          selectedPlace = origin;
          showMarker(origin);
          requestRecommendation(origin);
        },
        err => {
          alert("❌ 위치 정보를 가져올 수 없습니다.");
        }
      );
    }
  });

  // URL 파라미터로 좌표 전달된 경우 자동 추천
  const params = new URLSearchParams(window.location.search);
  const lat = parseFloat(params.get('lat'));
  const lon = parseFloat(params.get('lon'));
  if (lat && lon) {
    const origin = { lat, lon };
    selectedPlace = origin;
    showMarker(origin);
    requestRecommendation(origin);
  }
};

// 🔍 자동완성 기능
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
        div.className = 'suggestion-item';
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

// 📍 추천 버튼 눌렀을 때
function findTraumapoint() {
  if (!selectedPlace) {
    alert("⛔ 장소를 먼저 선택하세요.");
    return;
  }
  requestRecommendation(selectedPlace);
}

// ✅ 서버에 추천 요청
function requestRecommendation(origin) {
  document.getElementById("loading").style.display = "block";

  fetch("/api/traumapoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin })
  })
    .then(res => res.json())
    .then(data => {
      showResults(data.recommendations, origin, data.directToGilETA);
    })
    .catch(err => alert("❌ 경로 추천 실패: " + err.message))
    .finally(() => {
      document.getElementById("loading").style.display = "none";
    });
}

// 🗺️ 지도와 마커 표시
function showMarker(coord) {
  kakao.maps.load(() => {
    const container = document.getElementById('map');
    container.innerHTML = '';
    const map = new kakao.maps.Map(container, {
      center: new kakao.maps.LatLng(coord.lat, coord.lon),
      level: 3
    });
    new kakao.maps.Marker({
      map,
      position: new kakao.maps.LatLng(coord.lat, coord.lon)
    });
  });
}

// 🧾 추천 결과 출력 (임시 콘솔 출력)
function showResults(groups, origin, directToGilETA) {
  console.log("📦 추천 결과:", groups);
  // 교수님이 기존에 사용하시던 마크업 출력 구조를 여기에 넣으시면 됩니다.
}
