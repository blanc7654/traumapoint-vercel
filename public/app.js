let selectedPlace = null;

window.onload = function () {
  const wait = setInterval(() => {
    if (window.kakao && kakao.maps && kakao.maps.load) {
      clearInterval(wait);
      kakao.maps.load(initApp);
    }
  }, 100);
};

function initApp() {
  const input = document.getElementById("startInput");
  const suggestBox = document.getElementById("suggestions");

  // ✅ 자동완성
  input.addEventListener("input", (e) => {
    const keyword = e.target.value.trim();
    suggestBox.innerHTML = "";
    if (!keyword) return;

    fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}`, {
      headers: {
        Authorization: "KakaoAK 15c28ebb75dda243548737ac615a5681"
      }
    })
      .then(res => res.json())
      .then(data => {
        data.documents.slice(0, 5).forEach(p => {
          const div = document.createElement("div");
          div.textContent = p.place_name;
          div.onclick = () => {
            selectedPlace = { lat: parseFloat(p.y), lon: parseFloat(p.x), name: p.place_name };
            input.value = p.place_name;
            suggestBox.innerHTML = "";
            showMap(selectedPlace);
          };
          suggestBox.appendChild(div);
        });
      });
  });

  // ✅ 추천 버튼
  document.getElementById("searchBtn").addEventListener("click", () => {
    if (!selectedPlace) return alert("장소를 선택하세요.");
    requestRecommendation(selectedPlace);
  });

  // ✅ 현재 위치
  document.getElementById("currentLocationBtn").addEventListener("click", () => {
    if (!navigator.geolocation) return alert("지원 안됨");
    navigator.geolocation.getCurrentPosition(pos => {
      const origin = {
        lat: parseFloat(pos.coords.latitude.toFixed(7)),
        lon: parseFloat(pos.coords.longitude.toFixed(7))
      };
      selectedPlace = origin;
      showMap(origin);
      requestRecommendation(origin);
    }, () => alert("위치 접근 불가"));
  });

  // ✅ 최초 파라미터 있을 경우
  const params = new URLSearchParams(window.location.search);
  const lat = parseFloat(params.get('lat'));
  const lon = parseFloat(params.get('lon'));
  if (lat && lon) {
    const origin = { lat, lon };
    selectedPlace = origin;
    showMap(origin);
    requestRecommendation(origin);
  }
}

function showMap(coord) {
  const container = document.getElementById("map");
  container.innerHTML = "";
  const map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(coord.lat, coord.lon),
    level: 3
  });
  new kakao.maps.Marker({
    map: map,
    position: new kakao.maps.LatLng(coord.lat, coord.lon)
  });
}

function requestRecommendation(origin) {
  fetch("/api/traumapoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin })
  })
    .then(res => res.json())
    .then(data => {
      console.log("📦 추천 결과:", data);
      alert("추천 결과가 콘솔에 출력되었습니다.");
    })
    .catch(err => {
      alert("추천 요청 실패");
      console.error(err);
    });
}
