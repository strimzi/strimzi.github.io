---
layout: default
---

# Contributing

You can contribute by:

* Raising any issues you find using Strimzi
* Fixing issues by opening Pull Requests
* Improving documentation
* Talking about Strimzi

All bugs, tasks or enhancements are tracked as [GitHub issues](https://github.com/strimzi/strimzi-kafka-operator/issues). 
Issues which might be a good start for new contributors are marked with the ["good-start"](https://github.com/strimzi/strimzi-kafka-operator/labels/good-start) label.

The [Hacking guide](https://github.com/strimzi/strimzi-kafka-operator/blob/master/HACKING.md) describes how to build Strimzi and how to test your changes before submitting a patch or opening a PR.

The [Documentation Contributor Guide](https://strimzi.io/contributing/guide/) describes how to contribute to Strimzi documentation.

If you want to get in touch with us first before contributing, you can use:

* [#strimzi channel on CNCF Slack](https://slack.cncf.io/)
* [Strimzi Dev mailing list](https://lists.cncf.io/g/cncf-strimzi-dev/topics)

# How to become a maintainer

The governance of the project is defined in the [GOVERNANCE.md](https://github.com/strimzi/strimzi-kafka-operator/blob/master/GOVERNANCE.md) file in the Strimzi Github repository, but in summary certain members of the community are the "maintainers" who decide the direction of the project. New maintainers can be elected by a ⅔ majority vote of the existing maintainers.

 So as to be transparant and to ensure that all potential maintainers are judged fairly and consistently the following criteria should be taken into account in electing new maintainers:

## Mandatory criteria
Evidence of _all_ of the following are required:

* Sustained contributions over at least 3 months including at least two non-trivial PRs.
* An area of developing expertise. The candidate does not have to be the _go-to_ expert, but they should have a more than superficial understanding of at least one area. For example:
    - A particular operator
    - Some Kubernetes concern (CRDs, API, JSON Schema etc).
    - Some associated bit of Kafka technology in which the project has a strategic interest (e.g. Cruise Control)
    - System tests

## Additional criteria
None of these are _strictly_ required, but they're definitely beneficial: 

* Contributing to multiple aspects of the project and community. For example it’s not enough to just implement features. We should also consider:
    - bug reporting and fixing
    - Addressing technical debt
    - Documentation
    - helping users on Slack, the mailing list, stackoverflow etc.
    - Promotion of Strimzi (e.g. blogging, conferences etc.)
* An understanding of the overall architecture/structure of the codebase.
* Knowing when to ask for help or seek consensus.
* An indication of being committed to the long term success of the project.

## Examples

These are purely illustrative.

**Example 1:** Contributor _X_ who started fixing simple bugs around 3 months ago and has recently got a large feature merged.

**Likely decision:** Not ready _yet_ because they’ve only had one non-trivial PR merged. This would likely change with another significant PR.

**Example 2:** Contributor _Y_ who started with an initial big-ish PR and has followed it up with bug fixes to this feature (because they needed it at their company), but has shown no broader interest in the project.

**Likely outcome:** Not ready _yet_, because they don’t appear to be committed to the project, but rather just needed some feature to be implemented. This could change with further contributions (even if their interest is still mainly in using Strimzi as their company). For example two or three non-trivial PRs would probably be enough.

**Example 3:** Contributor _Z_ who has ≥ 6 month history making incremental improvements to a particular area (e.g. tests or tech debt) and shown good judgement in asking for input from the community/maintainers at appropriate times.

**Likely outcome:** Ready, because over 6 months they’ve developed an area of expertise and the 6 month investment in the project suggests they’re in it for the long haul.
