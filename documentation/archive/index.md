---
layout: default
---

# Documentation archive

## Strimzi Kafka operators

{% for item in site.data.releases.operator -%}
### {{item.version}}

{% if item.overview_book == true -%}
* [Overview Guide](/docs/overview/{{item.version}}/)
{% endif -%}

{% if item.quickstart_book == true -%}
* [Quick Start Guide](/docs/quickstart/{{item.version}}/)
{% endif -%}

{% if item.using_book == true and item.version != "0.1.0" -%}
* [Using Strimzi](/docs/{{item.version}}/)
{% else -%}
* [Using Strimzi](/docs/0.1.0/README.md)
{% endif -%}

{% endfor -%}


## Strimzi Kafka bridge

{% for item in site.data.releases.bridge -%}
* [{{item.version}}](/docs/bridge/{{item.version}}/)
{% endfor -%}