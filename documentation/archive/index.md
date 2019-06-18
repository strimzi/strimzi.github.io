---
layout: default
---

# Documentation archive

## Strimzi Kafka operators

{% for item in site.data.releases.operator -%}
{% if item.version != "0.1.0" -%}
* [{{item.version}}](/docs/{{item.version}}/)
{% else -%}
* [0.1.0](/docs/0.1.0/README.md)
{% endif -%}
{% endfor -%}



## Strimzi Kafka bridge

{% for item in site.data.releases.bridge -%}
* [{{item.version}}](/docs/{{item.version}}/)
{% endfor -%}