---
layout: post
title:  "Accessing Kafka: Part 4 - Load Balancers"
date: 2019-05-13
author: jakub_scholz
---

In the fourth part of this blog post series we will look at exposing Kafka using load balancers.
This post will explain how to use load balancers in public cloud environments and how they can be used with Kafka.

<!--more-->

_This post is part of a bigger series about different ways to access a Kafka cluster powered by Strimzi.
The other parts published so far are:_

* _[Part 1 - Introduction](https://strimzi.io/2019/04/17/accessing-kafka-part-1.html)_
* _[Part 2 - Node Ports](https://strimzi.io/2019/04/23/accessing-kafka-part-2.html)_
* _[Part 3 - OpenShift Routes](https://strimzi.io/2019/04/30/accessing-kafka-part-3.html)_
* _Part 4 - Load Balancers (this post)_
* _[Part 5 - Ingress](https://strimzi.io/2019/05/23/accessing-kafka-part-5.html)_

## Load balancers

Load balancers automatically distribute incoming traffic across multiple targets.
Different implementations do the traffic distribution on different levels:

* [Layer 7](https://en.wikipedia.org/wiki/OSI_model#Layer_7:_Application_Layer) load balancers can distribute the traffic on the level of individual requests (for example HTTP requests)
* [Layer 4](https://en.wikipedia.org/wiki/OSI_model#Layer_4:_Transport_Layer) load balancers distribute the TCP connections

Load balancers are available in most public and private clouds.
Examples of load balancers are Elastic Load Balancing services from Amazon AWS, Azure Load Balancer in Microsoft Azure public cloud or Google Cloud Load Balancing service from Google.
Load balancing services are also [available in OpenStack](https://docs.openstack.org/mitaka/networking-guide/config-lbaas.html).
If you run your Kubernetes or OpenShift cluster on bare metal, you might not have load balancers available on demand.
In that case, using node ports, OpenShift Routes or Ingress might be a better option for you.

There's no need to be scared by the long list of different load balancing services.
Most of them are very well integrated with Kubernetes.
When the Kubernetes `Service` is configured with the type `Loadbalancer`, Kubernetes will automatically create the load balancer through the cloud provider, which understands the different services offered by given cloud.
Thanks to that, Kubernetes applications – including Strimzi – do not need to understand the differences and should work everywhere where the cloud infrastructure and Kubernetes are properly integrated.

## Using load balancers in Strimzi

Since none of the common load balancing services supports the Kafka protocol, Strimzi always uses the Layer 4 load balancing.
Since Layer 4 works on the TCP level, the load balancer will always take the whole TCP connection and direct it to one of the targets.
That has some advantages – you can, for example, decide whether TLS encryption should be enabled or disabled.

To give Kafka clients access to the individual brokers, Strimzi creates a separate service with `type=Loadbalancer` for each broker.
As a result, each broker will get a separate load balancer _(despite the Kubernetes service being of a load balancer type, the load balancer is still a separate entity managed by the infrastructure / cloud)_.
A Kafka cluster with N brokers will need N+1 load balancers.

![Accessing Kafka using load balancers]({{ "/assets/images/posts/2019-05-13-per-pod-load-balancers.png" }})

At the beginning of this post we defined load balancer as something that _distributes incoming traffic across multiple targets_.
However, as you can set from the diagram above, the per-broker load balancers have only one target and are technically not load balancing.
That is true, but in most cases the actual implementation is a bit more complicated.

When Kubernetes creates the load balancer, they usually target it to all nodes of your Kubernetes cluster and not only to the nodes where your application is actually running.
That means that although the TCP connections will always end on the same node in the same broker, they might be routed through the other nodes of your cluster.
When the connection is sent by the load balancer to the node which does not host the Kafka broker, the `kube-proxy` component of Kubernetes will forward it to the right node where the broker runs.
This can lead to some delays since some of the connections might be routed through more hops than absolutely necessary.

![Routing of connections through `kube-proxy`]({{ "/assets/images/posts/2019-05-13-connection-routing.png" }})

The only exception is the bootstrap load balancer which is distributing the connections to all brokers in your Kafka cluster.

You can very easily configure Strimzi Kafka operator to expose your Kafka cluster using load balancers by selecting the `loadbalancer` type in the external listener:

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    # ...
    listeners:
      # ...
      external:
        type: loadbalancer
    # ...
```

Load balancers, in common with the node port external listener, have TLS enabled by default.
If you don't want to use TLS encryption, you can easily disable it:

```yaml
    # ...
    listeners:
      external:
        type: loadbalancer
        tls: false
    # ...
```

After Strimzi creates the load balancer type Kubernetes services, the load balancers will be automatically created.
Most clouds will automatically assign the load balancer some DNS name and IP addresses.
These will be automatically propagated into the `status` section of the Kubernetes service.
Strimzi will read it from there and use it to configure the advertised address in the Kafka brokers.
When available, Strimzi currently always prefers the DNS name over the IP address.
The reason is that the IP addresses are often volatile while the DNS name is fixed for the whole lifetime of the load balancer (this applies at least to Amazon AWS ELB load balancers).
But if the load balancer has only an IP address, Strimzi will of course use it.

As a user, you should always use the bootstrap load balancer address for the initial connection.
You can get the address from the `status` section with following command (replace `my-cluster` with the name of your cluster):

```
kubectl get service my-cluster-kafka-external-bootstrap -o=jsonpath='{.status.loadBalancer.ingress[0].hostname}{"\n"}'
```

In case there is no hostname set, you can also try the IP address (replace `my-cluster` with the name of your cluster):

```
kubectl get service my-cluster-kafka-external-bootstrap -o=jsonpath='{.status.loadBalancer.ingress[0].ip}{"\n"}'
```

The DNS or IP returned by one of these commands can be used in your clients as the bootstrap address.
The load balancers use always the port `9094` to expose Apache Kafka.
The following example uses the `kafka-console-producer.sh` utility which is part of Apache Kafka to connect the cluster:

```
bin/kafka-console-producer.sh --broker-list <load-balancer-address>:9094 --topic <your-topic>
```

For more details, see the [Strimzi documentation](https://strimzi.io/docs/latest/full.html#proc-accessing-kafka-using-loadbalancers-deployment-configuration-kafka).

## Customizations

### Advertised hostnames and ports

In the section above, I explained how Strimzi will always prefer to use the DNS name over the IP address when configuring the advertised listener address in Kafka brokers.
Sometimes, this might be a problem - for example when for whatever reason the DNS resolution doesn't work for your Kafka clients.
In that case you can override the advertised hostnames in the `Kafka` custom resource.

```yaml
# ...
listeners:
  external:
    type: loadbalancer
    overrides:
      brokers:
      - broker: 0
        advertisedHost: 216.58.201.78
      - broker: 1
        advertisedHost: 104.215.148.63
      - broker: 2
        advertisedHost: 40.112.72.205
# ...
```

I hope that in one of the future versions we will give users a more comfortable option to choose between the IP address and hostname.
But this feature might be useful to handle also different kinds of network configurations and translations.
If needed, you can also use it to override the node port numbers as well.

```yaml
# ...
listeners:
  external:
    type: route
    authentication:
      type: tls
    overrides:
      brokers:
      - broker: 0
        advertisedHost: 216.58.201.78
        advertisedPort: 12340
      - broker: 1
        advertisedHost: 104.215.148.63
        advertisedPort: 12341
      - broker: 2
        advertisedHost: 40.112.72.205
        advertisedPort: 12342
# ...
```

Just keep in mind that the `advertisedPort` option doesn't really change the port used in the load balancer itself.
It changes only the port number used in the `advertised.listeners` Kafka broker configuration parameter.

### Internal load balancers

Many cloud providers differentiate between _public_ and _internal_ load balancers.
The public load balancers will get a public IP address and DNS name which will be accessible from the whole internet.
On the other hand the internal load balancers will only use private IP addresses and hostnames and will be available only from certain private networks (for example from other machines in the same Amazon AWS VPC).

Often, you want to share you Kafka cluster managed by Strimzi with applications running outside of your Kubernetes or OpenShift cluster but not necessarily with the whole world.
In such case the internal load balancers might be handy.

Kubernetes will usually always try to create a public load balancer by default.
And users can use special annotations to indicate that given Kubernetes service with load balancer type should have the load balancer created as internal.

For example:

* For Google Cloud, use the annotation `cloud.google.com/load-balancer-type: "Internal"`
* On  Microsoft Azure use `service.beta.kubernetes.io/azure-load-balancer-internal: "true"`
* Amazon AWS is using `service.beta.kubernetes.io/aws-load-balancer-internal: 0.0.0.0/0`
* And OpenStack uses `service.beta.kubernetes.io/openstack-internal-load-balancer: "true"`

As you can see, most of these are completely different.
So instead of integrating all of these into Strimzi, we decided to just give you the option to specify the annotations for the services which Strimzi creates.
Thanks to that you can use these annotations with cloud providers we've never even heard of.
The annotations can be specified in the `template` property in `Kafka.spec.kafka`.
The following example shows the OpenStack annotations:

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    # ...
    template:
      externalBootstrapService:
        metadata:
          annotations:
            service.beta.kubernetes.io/openstack-internal-load-balancer: "true"
      perPodService:
        metadata:
          annotations:
            service.beta.kubernetes.io/openstack-internal-load-balancer: "true"
    # ...
```

You can specify different annotations for the bootstrap and the per-broker services.
After you specify these annotations, they will be passed by Strimzi to the Kubernetes services, and the load balancers will be created accordingly.

### DNS annotations

**This feature will be available from Strimzi 0.12.0.**

Many users are using some additional tools such as [ExternalDNS](https://github.com/kubernetes-incubator/external-dns) to automatically manage DNS records for their load balancers.
External DNS uses annotations on load balancer type services (and `Ingress` resources – more about that next time) to manage their DNS names.
It supports many different DNS services such as Amazon AWS Route53, Google Cloud DNS, Azure DNS etc.

Strimzi lets you assign these annotations through the `Kafka` custom resource using a field called `dnsAnnotations`.
The main difference between the template annotations mentioned in previous section is that the `dnsAnnotations` allow you to configure the annotation per-broker. Where as the `perPodService` option of the `template` field will set the annotations on _all_ services.

Using the DNS annotations is simple:

```yaml
# ...
listeners:
  external:
    type: loadbalancer
    overrides:
      bootstrap:
        dnsAnnotations:
          external-dns.alpha.kubernetes.io/hostname: kafka-bootstrap.mydomain.com.
          external-dns.alpha.kubernetes.io/ttl: "60"
      brokers:
      - broker: 0
        dnsAnnotations:
          external-dns.alpha.kubernetes.io/hostname: kafka-broker-0.mydomain.com.
          external-dns.alpha.kubernetes.io/ttl: "60"
      - broker: 1
        dnsAnnotations:
          external-dns.alpha.kubernetes.io/hostname: kafka-broker-1.mydomain.com.
          external-dns.alpha.kubernetes.io/ttl: "60"
      - broker: 2
        dnsAnnotations:
          external-dns.alpha.kubernetes.io/hostname: kafka-broker-2.mydomain.com.
          external-dns.alpha.kubernetes.io/ttl: "60"
# ...
```

Again, Strimzi lets you configure the annotations directly.
That gives you more freedom and hopefully makes this feature usable even when you use some other tool then External DNS.
It also lets you configure other options than just the DNS names, such as the time-to-live of the DNS records etc.

Please note that the addresses used in the annotations will not be added to the TLS certificates or configured in the advertised listeners of the Kafka brokers.
To do so, you need to combine them with the advertised name configuration described in one of the previous sections:

```yaml
# ...
listeners:
  external:
    type: loadbalancer
    overrides:
      bootstrap:
        dnsAnnotations:
          external-dns.alpha.kubernetes.io/hostname: kafka-bootstrap.mydomain.com.
        address: kafka-bootstrap.mydomain.com
      brokers:
      - broker: 0
        dnsAnnotations:
          external-dns.alpha.kubernetes.io/hostname: kafka-broker-0.mydomain.com.
        advertisedHost: kafka-broker-0.mydomain.com
      - broker: 1
        dnsAnnotations:
          external-dns.alpha.kubernetes.io/hostname: kafka-broker-1.mydomain.com.
        advertisedHost: kafka-broker-1.mydomain.com
      - broker: 2
        dnsAnnotations:
          external-dns.alpha.kubernetes.io/hostname: kafka-broker-2.mydomain.com.
        advertisedHost: kafka-broker-2.mydomain.com
# ...
```

## Pros and cons

The integration of load balancers into Kubernetes and OpenShift is very convenient and makes them very easy to use.
Strimzi can use the power of Kubernetes to provision them on many different public and private clouds.
Thanks to the TCP routing, you can freely decide whether you want to use TLS encryption or not.

The load balancers are also something what stands between the applications and the nodes of the Kubernetes cluster.
It minimizes the attack surface and for this reason many admins would prefer load balancers over node ports.

Load balancers usually deliver very good performance.
The typical load balancer is a service which runs outside of your cluster.
So you do not need to be afraid of the resources it needs, how much load will it put on your cluster and so on.
However, there are some things to keep in mind:

* In most cases, Kubernetes will configure them to load balance across all cluster nodes.
So despite there being only one broker where the traffic will ultimately arrive, different connections might be routed to that broker through different cluster nodes, being forwarded through the `kube-proxy` to the right node where the Kafka broker actually runs.
This would not happen for example with node ports, where the advertised address points directly to the node where the broker is running.
* The load balancer itself is yet another service which the connection needs to go through.
That might add a little bit of latency

Another aspect which you should consider is the price.
In public clouds, the load balancers are normally not free.
Usually you have to pay some fixed fee per instance which depends only on how long the load balancer exists plus some fee for every transferred gigabyte.
Strimzi always requires N+1 load balancers (where N is the number of brokers) - one for each broker + one for the bootstrapping.
So you will always need multiple load balancers and the fees add up.
And N of those load balancers don't even balance any load because there is only a single broker behind them.



