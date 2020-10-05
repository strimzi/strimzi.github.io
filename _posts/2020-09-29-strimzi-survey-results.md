---
layout: post
title:  "Insights from the first Strimzi survey"
date: 2020-09-29
author: tom_bentley
---

In August, with the help of the CNCF, we ran a survey of the Strimzi community. 
This was prompted, in part, by the maintainers wanting to make decisions based on a better understanding of how the community is using Strimzi and what would best serve the common good in the future.
As maintainers we spend a lot of time working with people for whom Strimzi isn't working, or who really want some particular feature. 
We don't tend to hear much from people who can't or don't want to open issues or PRs or who don't interact on Slack.
So this was an attempt to get an impression about how well Strimzi is surving _all_ of its community.

If you took the time to complete the survey, thank you. 

The rest this blog post is our analysis of the results of the survey.

<!-- more -->

First the numbers. 
We had about 40 respondants overall, but since no questions were mandatory the numbers are different for each answer.
We'd previously done an informal Twitter poll to answer the specific question: "how do you install Strimzi", this had more than twice as many votes. 
Perhaps the difference is explained by the time investment required for a longer survey, or that we ran the survey in August when many people are taking vacation.

Let's get on to the questions...

## Usage

Nearly 40% of respondants were using Strimzi in production.
Over 50% were using it in a staging or development environment and
about 15% were using it locally for development. 
These don't sum to 100% because people could choose more than one option.

## Kubernetes distributions and versions

Over 55% of respondants were running Strimzi on OpenShift.
This is likely a reflection of Red Hat being the company which started Strimzi.
In comparison 25% were using it on Amazon's EKS and the same on Google's GKE.
It will be interesting to see how these numbers look next year assuming we run the survey again.

Over 25% were using it on some development cluster, such as minikube, kind etc. 
Kind was as popular as minikube.

In terms of Kubernetes versions it breaks down as follows:

* 15% using Kubernetes 1.18
* 38% using 1.17
* 19% using 1.16
* 8% using 1.15
* 4% using 1.14
* 15% using 1.11

This was a free-text answer. We did this because we thought some users might be using multiple versions, e.g. a newer version for development and an older version in production.
In practice 15% of the answers were neither valid Kubernetes versions nor seemed to be valid versions of the distribution the respondant had identified.
So a lesson learned for if we run a survey next year.

## Installation

As mentioned, we'd previously run an informal twitter poll on this question when deciding to remove support for Helm 2.
We included this question anyway so that we can better see a trend if we run another survey in future.
It's a roughly even split:

* 38% were using Helm 3.
* 31% were using `kubectl apply` with the YAML we provide.
* 25% were installing from Operatorhub.
* 18% were using something else. This includes Helm 2, Flux and Kustomize over the YAML we provide.

As you might guess from the decision to drop support for Helm 2, the project 
doesn't really have enough capacity to support every available installation 
mechanism, so we've no plans for change here.

## Usage of components

We wanted to get an impression about which custom resources (CR) people are using. 
Strimzi is flexible and people can pick and choose what they want to use. 

The `Kafka` is the most popular CR, which isn't surprising since it gives you want most Strimzi users came for: Kafka on Kubernetes. 
`KafkaTopic`, closely followed by `KafkaUser`, are next most popular. Again this not a surprise because they enable Strimzi's Kubernetes-native Kafka vision.

When it comes to Kafka Connect `KafkaConnectS2I` has about 1/3 of the usage 
of plain `KafkaConnect`. The relatively new `KafkaConnector` CR is about 60% of the combined `KafkaConnect` and `KafkaConnectS2I` usage.
This suggests that a signifiant number of users prefer declarative connector deployment over having to talk to the Kafka Connect REST API directly.

`KafkaMirrorMaker2` is about twice as popular as `KafkaMirrorMaker`, but lots still "plan to use MM1".
In hindsight the question here was a bit ambiguous. Are those MM1 users planning to continue their existing usage of MM1, or planning a new deployment of MM1?

The newest CR, `KafkaRebalance`, has about 20% usage, but lots plan to use it, so this is likely just a reflection of it's newness.

Mostly respondants were managing these things themselves, rather than them being managed by others within their organisation.
But when writing the questions we didn't break out "I manage this for myself only", from "I manage this for other Strimzi users in my org", so yet another lesson for next time.

## Contribution

We wanted to get a clearer impression of the users who don't interact much with the project, as well as those who open issues or we help directly on the Strimzi channel on the CNCF Slack. 

* 40% haven't needed to contribute
* 28% have requested a feature
* 18% have reported a bug
* 10% have contributed 
* 28% would like to contribute, but haven't yet
* Only 2.5% were active contributors. 

From this we take two messages:

* Too many users are encountering bugs (though in fairness perhaps people who have had to report bugs are also more likely to be engaged enough with the project to fill in the survey)
* There's a good-sized pool of people wanting to contribute, if only we can help them to do so. If this is you, look out for a follow up blog post in the next few weeks.

## Wanted features

This was another free text answer, because we didn't want to constrain people to what we already have on the backlog. As a result the comments people made where sometimes ambiguous and open to interpretation. Here's our understanding of what members of the community are asking for, in decreasing order of popularity:

1. Various "UI"-type requirements, for Kafka and CC. A lot of the ask here is metrics/monitoring and alerting OOTB, though it's not completely clear how many people wanted the metrics integrated into a UI or were happy with Grafana dashboards.

2. More balancing-related functionality. This includes balancing replicas when adding and removing disks as well as support for balancing for individual topics and changing the replication factor.

3. Better cert handling/integration with things like cert-manager and Vault were also popular.

At the tail-end, with the same number of requesters:

* A better experience when managing connectors. Specifically people find it cumbersome having to build and maintain images and suggestions that a catalog would make it easier to find connectors. 
* Autoscaling. This is a bit ambiguous because a Kafka cluster can be scaled horizontally and vertically, but also increasing the number of partitions is also a way of scaling individual topics. 
* A better upgrade experience.
* A Strimzi CLI

There is already an effort underway to bring a UI to Strimzi, but it's still in relatively early stages.
As for the others, we also already had them on our backlog, but knowing the relative interest of users helps with prioritization.

## Images

This was partly a question to tease out how many people have to deal with the project's functional-but-hardly-pretty `make` and `mvn` build system. 

* Nearly 3/4 of people said they are using the images supplied by the project.
* 10% are building custom images with modifications.

In hindsight this was another ambiguous question because we don't really know why or whether people were counting having to build their own Kafka Connect images here or not.

## Accessing Kafka

* Using TLS for within-Kubernetes access is far-and-away the most common way of accessing the Kafka cluster.
* For external access it was a fairly even split between routes, ingress or loadbalancer.
* Relatively few people were using nodeport for out of cluster access, only 8%.

## Authentication and authorization

Most people said they were using TLS client authentication, followed by Oauth authentication and then SCRAM-SHA.

Perhaps surprisingly Keycloak was the most popular solution for authorization and
OPA was as popular as Kafka's native ACLs.

This is another question where answers from future survey will be interesting, given OPA's flexibility and typical enterprise authorization needs.

## Docs

We got some detailed feedback about the documentation, which was a mixture of 
both structured and free text answers. Of note:

* Some people had trouble finding the documentation they needed, even though it existed. 
We'll be making some changes to the website to better signpost people to resources they might find useful.

* Naturally people are always interested in how to take a project like Strimzi and turn it into their production cluster suitable for their infrastructure and workload.
This is really hard to do because so much depends on that infrastructure and workload that it's difficult to write documentation that is universally applicable. 
Or, in other words, it's easy to end up with documentation which is so full of caveats and unknowns that it's not actually useful to anybody. 

* People were interested in more documentation around mirror maker and replication. 
Without making any promises, this seems very reasonable and we'll see what we can do.

## Conclusion

If you're read this far you'll see that we made a bunch of mistakes in writing the survey questions which we will learn from if we do this again next year.

We've also gained some useful insights into how people (or at least those who did the survey) are using Strimzi and this will help guide our efforts going forward. 

