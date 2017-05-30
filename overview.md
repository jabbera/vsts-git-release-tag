# Tag Git Source on Release

This is a vsts plugin that will git tag artifact source code with the release name. This makes it very easy to patch in the future if needed. When the task runs it finds all linked artifacts that originated from a TfsGit source repo and tags them with the release name. This is meant to be super simple, no paramters or anything. Just drop in your release pipeline and go. If you wish to configure a regular expression and pattern for the replacement that is also possible using the advanced settings.

Note: Currently this take does not support directly linked TfsGit artifacts. They must currently go though a build. Once [this](https://github.com/Microsoft/vsts-agent/issues/976) is fixed, those can be supported as well. I have no plans to support external git repos.

Icons made by Dave Gandy from http://www.flaticon.com is licensed by CC 3.0 BY