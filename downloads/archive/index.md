---
layout: default
---

# Downloads archive

## Strimzi Kafka operators

{% for item in site.data.releases.operator -%}
* [{{item.version}}](https://github.com/strimzi/strimzi-kafka-operator/releases/tag/{{item.version}})
{% endfor -%}

## Strimzi Kafka bridge

{% for item in site.data.releases.bridge -%}
* [{{item.version}}](https://github.com/strimzi/strimzi-kafka-bridge/releases/tag/{{item.version}})
{% endfor -%}
