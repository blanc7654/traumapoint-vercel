let selectedPlace = null;

window.onload = function () {
  // ✅ kakao 객체가 로드될 때까지 기다렸다가 load 실행
  const waitForKakao = setInterval(() => {
    if (window.kakao && window.kakao.maps && typeof kakao.maps.load === "function") {
      clearInterval(waitForKakao);
      kakao.maps.load(initApp); // ✅ 지도 로딩 시작
    }
  }, 100); // 100ms 간격으로 체크
};

function initApp() {
  const container = document.getElementById('map');
  const map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(37.5665, 126.978),
    level: 3
  });
  new kakao.maps.Marker({
    map: map,
    position: new kakao.maps.LatLng(37.5665, 126.978)
  });

  // ✅ 여기 이후로 기존 이벤트 연결, 자동완성, 추천 요청 등 추가하면 됩니다
}