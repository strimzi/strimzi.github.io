$(document).ready(function() {

  $('.card').click(function() {

    var cardId = event.currentTarget.id;
    var contentWrapper = $("#content_" + cardId);

    // Hides previously open content
    $(".connector-content-wrapper.open").removeClass("open");

    // Displays content for clicked card
    contentWrapper.addClass("open");
    $(".cards-grid-wrapper").addClass("half-width");

    viewPicker();
    updateURL(cardId);

  });

  // Closes content and makes cards wrapper full width when 'X' is clicked
  $('.exit-content').click(function() {
    $(".connector-content-wrapper").removeClass("open");
    $(".cards-grid-wrapper").removeClass("half-width");
    window.history.replaceState(null, null, window.location.pathname);

    if( $(window).width() <= 1024 ) {
      $(".secondary-page-title-band, .cards-grid-wrapper").removeClass("hidden");
    }
  });

  function mobileView(){

    if( $('div.open').length ) {
      var x = $('div.open').length;
      console.log(x);
    }
    $(".secondary-page-title-band, .cards-grid-wrapper").addClass("hidden");
    $(".connector-content-wrapper").addClass("width-12-12");
  };

  function desktopView(){
    $(".secondary-page-title-band, .cards-grid-wrapper").removeClass("hidden");
    $(".connector-content-wrapper").removeClass("width-12-12");
  };

  function resizedw(){
    // Checks if content is open and window was resized to < 1024px
    viewPicker();
  };

  function updateURL(cardId) {
    if (history.pushState) {
      var newurl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?card=' + cardId;
      window.history.pushState({path:newurl},'',newurl);
    }
   }

  function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
  };

  function openUrlCard() {
    var card = getUrlParameter('card');

    if( card !== '' ) {
      // Displays content for clicked card
      $("#content_" + card).addClass("open");
      $(".cards-grid-wrapper").addClass("half-width");
      viewPicker();
    }
    else {
      return;
    }
  };

  function viewPicker() {
    if( ($(window).width() <= 1024 ) && ($('div.open').length) ) {
      mobileView();
      window.scrollTo(0, 0);
    }
    else if( $(window).width() > 1024 ) {
     desktopView();
    }
  };

  var resize;
  window.onresize = function(){
    clearTimeout(resize);
    resize = setTimeout(resizedw, 0);
  };

  openUrlCard();
  viewPicker();

});
