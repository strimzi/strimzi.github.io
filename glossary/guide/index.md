---
title: Glossary
layout: default
---

{% include_relative glossary.html %}

<script>
document.addEventListener("DOMContentLoaded", function() {
  
  var docsPath = "{{ '/docs/operators/latest/' | relative_url }}";
  var allLinks = document.querySelectorAll('a');

  allLinks.forEach(function(link) {
    var originalHref = link.getAttribute('href');

    // Internal link check
    if (originalHref && 
        originalHref.includes('.html') && 
        !originalHref.startsWith('http')) {
      
      // Removes the .html
      var newHref = originalHref.replace('./', '').replace('.html', '');
      
      // adds latest path
      link.setAttribute('href', docsPath + newHref);
    }
  });

});
</script>