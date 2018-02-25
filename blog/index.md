---
layout: default
---

<ul>
  {% for post in site.posts %}
    <li>
      <a href="{{ post.url }}"><b>{{ post.title }}</b></a>
      <p>({{ post.date | date_to_string }})</p>
      <p>{{ post.excerpt }}</p>
    </li>
  {% endfor %}
</ul>