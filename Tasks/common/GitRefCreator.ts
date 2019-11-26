import * as vsts from "azure-devops-node-api";
import * as bld from "azure-devops-node-api/BuildApi";
import * as git from "azure-devops-node-api/GitApi";
import * as bldi from "azure-devops-node-api/interfaces/BuildInterfaces";
import * as giti from "azure-devops-node-api/interfaces/GitInterfaces";
import * as tl from "azure-pipelines-task-lib/task";
import IArtifactData from "./IArtifactData";

export abstract class GitRefCreator {
    readonly defaultSearchPattern: string = "\\s+";
    readonly defaultRegexFlags: string = "g";
    readonly defaultReplacePattern: string = "";
    readonly defaultStaticTagName: string = "";
    readonly permissionTemplate: string = "You must grant the build account access to permission: ";

    protected abstract get refName(): string;

    protected constructor() {
        this.printVersion();
    }

    public async run() {
        try {

            let token: string = tl.getEndpointAuthorizationParameter("SYSTEMVSSCONNECTION", "AccessToken", false);
            let collectionUrl: string = tl.getEndpointUrl("SYSTEMVSSCONNECTION", false).replace(".vsrm.visualstudio.com", ".visualstudio.com"); // need build
            let authHandler = token.length === 52 ? vsts.getPersonalAccessTokenHandler(token) : vsts.getBearerHandler(token);
            let connect = new vsts.WebApi(collectionUrl, authHandler);

            let gitapi: git.IGitApi = await connect.getGitApi();
            let bldapi: bld.IBuildApi = await connect.getBuildApi();

            let artifactData: IArtifactData[] = await this.getAllGitArtifacts(bldapi, gitapi);

            if (artifactData.length === 0) {
                tl.warning("No TfsGit artifacts found.");
            }

            for (let artifact of artifactData) {
                await this.processArtifact(artifact, gitapi);
            }
        } catch (err) {
            tl.setResult(tl.TaskResult.Failed, err.message);
        }
    }

    protected generateRef(releaseName: string, prefix: string): string {
        if (releaseName == null || releaseName == undefined || releaseName == '') {
            return null;
        }

        let staticTagName: string = this.getInputOrDefault("staticTagName", this.defaultStaticTagName);
        let searchRegex: string = this.getInputOrDefault("searchRegex", this.defaultSearchPattern);
        let regexFlags: string = this.getInputOrDefault("regexFlags", this.defaultRegexFlags);
        let replacePattern: string = this.getInputOrDefault("replacePattern", this.defaultReplacePattern);

        tl.debug(`Search Regex: '${searchRegex}', Replace Pattern: '${replacePattern}', flags: '${regexFlags}', staticTagName: '${this.defaultStaticTagName}'`);

        let refName: string = null;
        if (staticTagName !== "") {
            refName = staticTagName;
        }
        else {
            let regex: RegExp = new RegExp(searchRegex, regexFlags);
            refName = releaseName.replace(regex, replacePattern);
        }

        refName = `${prefix}${refName}`;
        tl.debug(`RefName: '${refName}'`);

        return refName;
    }

    private getInputOrDefault(inputName: string, defaultValue: string): string {
        let value: string = tl.getInput(inputName, false);
        if (value != null) {
            return value;
        }

        return defaultValue;
    }

    private async getAllGitArtifacts(bldapi: bld.IBuildApi, gitapi: git.IGitApi): Promise<IArtifactData[]> {
        let artifactNames: IArtifactData[] = [];
        let regexp: RegExp = new RegExp("RELEASE\.ARTIFACTS\.(.*)\.REPOSITORY\.PROVIDER", "gi");

        for (let variableInfo of tl.getVariables()) {
            let match: RegExpExecArray = regexp.exec(variableInfo.name);
            if (match === null) {
                tl.debug(`No match for variable: ${variableInfo.name}`);
                continue;
            }

            if (variableInfo.value !== "TfsGit" && variableInfo.value !== "Git") {
                tl.debug(`Matching variable:  ${variableInfo.name}, but artifact type: ${variableInfo.value}`);
                continue;
            }

            let name: string = match[1];
            tl.debug(`Getting repository id for artifact: ${name}`);
            let repositoryId: string = await this.getRepositoryId(bldapi, name); // This should really be available via a variable
            if (repositoryId == null) {
                continue; // Error already logged
            }

            let artifact: IArtifactData = {
                "name": name,
                "commit": tl.getVariable(`RELEASE.ARTIFACTS.${name}.SOURCEVERSION`),
                "repositoryId": repositoryId.toLowerCase(),
                "oldCommitId": "0000000000000000000000000000000000000000",
            };

            artifactNames.push(artifact);
        }

        // Fallback to build information
        if (artifactNames.length === 0) {
            let buildProvider: string = tl.getVariable("build.repository.provider");
            if (buildProvider === "TfsGit" || buildProvider === "Git") {
                artifactNames.push({
                    "name": tl.getVariable("build.repository.name"),
                    "commit": tl.getVariable("build.sourceVersion"),
                    "repositoryId": tl.getVariable("build.repository.id"),
                    "oldCommitId": "0000000000000000000000000000000000000000",
                });
            }
        }

        return await this.filterArtifacts(gitapi, artifactNames);
    }

    // This is meant to fix https://github.com/jabbera/vsts-git-release-tag/issues/23
    // The user is using the same repo, but 2 different commits via 2 different artifacts.
    // For a given repository we should select only the most current commit.
    // My kingdom for a groupby
    private async filterArtifacts(gitapi: git.IGitApi, artifacts: IArtifactData[]) {
        if (artifacts.length <= 1) {
            return artifacts;
        }

        artifacts.sort((x, y) => {
            if (x.repositoryId === y.repositoryId) return 0;
            if (x.repositoryId < y.repositoryId) return -1;
            // if (tuple[0] > tuple[1])
            return 1;
        });

        artifacts = this.filterIncludedArtifacts(artifacts);

        let i: number;
        for (i = 1; i < artifacts.length; i++) {
            const prev: IArtifactData = artifacts[i - 1];
            const current: IArtifactData = artifacts[i];

            if (prev.repositoryId !== current.repositoryId) {
                continue;
            }

            if (prev.commit === current.commit) {
                continue;
            }

            let search = <giti.GitQueryCommitsCriteria>{
                ids: [prev.commit, current.commit],
            };

            tl.debug(`Attempting to determine which commit was last. Prev: ${prev.commit} Current: ${current.commit} for repository: ${prev.repositoryId}`);

            const commits: giti.GitCommitRef[] = await gitapi.getCommitsBatch(search, prev.repositoryId);
            if (commits.length !== 2) {
                tl.setResult(tl.TaskResult.Failed, `Cannot resolve difference most recent between two commits: ${prev.commit} ${current.commit}`);
                return artifacts;
            }

            let firstCommitArtifactIndex: number;
            let secondCommitArtifactIndex: number;

            if (artifacts[i - 1].commit === commits[0].commitId.toLowerCase()) {
                firstCommitArtifactIndex = i - 1;
                secondCommitArtifactIndex = i;
            } else {
                firstCommitArtifactIndex = i;
                secondCommitArtifactIndex = i - 1;
            }

            tl.debug(`Commit Info: { Id: ${commits[0].commitId} Date: ${commits[0].committer.date}} {Id: ${commits[1].commitId} Date: ${commits[1].committer.date}}`);

            if (commits[0].committer.date < commits[1].committer.date) {
                tl.debug(`Winning commit: ${commits[1].commitId}`);
                artifacts[firstCommitArtifactIndex].commit = artifacts[secondCommitArtifactIndex].commit;
            } else {
                tl.debug(`Winning commit: ${commits[0].commitId}`);
                artifacts[secondCommitArtifactIndex].commit = artifacts[firstCommitArtifactIndex].commit;
            }
        }

        return artifacts;
    }

    private filterIncludedArtifacts(artifacts: IArtifactData[]): IArtifactData[] {
        const includeMultiline: string[] = tl.getDelimitedInput("artifactIncludeList", "\r", false).map(x => x.replace("\n", ""));
        let includedArtifacts: Set<string>;

        if (includeMultiline === null || includeMultiline.length === 0) {
            tl.debug("inlcuding all artifacts");
            includedArtifacts = new Set<string>(artifacts.map((x) => x.name));
        }
        else {
            tl.debug("Filtering artifacts");
            includedArtifacts = new Set<string>(includeMultiline);
        }

        tl.debug(`Before filter count: ${artifacts.length}`);
        artifacts = artifacts.filter((value) => includedArtifacts.has(value.name));
        tl.debug(`After filter count ${artifacts.length}`);
        return artifacts;
    }

    private async getRepositoryId(bldapi: bld.IBuildApi, name: string): Promise<string> {
        let repositoryidVariable: string = `RELEASE.ARTIFACTS.${name}.REPOSITORY_ID`;
        let repositoryid: string = tl.getVariable(repositoryidVariable);

        if (repositoryid !== null && repositoryid !== "") {
            tl.debug(`Got repositoryid from variable: ${repositoryid}`);
            return repositoryid;
        }

        // YAML
        repositoryidVariable = `release.artifacts.${name}.repository.id`;
        repositoryid = tl.getVariable(repositoryidVariable);
        if (repositoryid !== null && repositoryid !== "") {
            tl.debug(`Got repositoryid from YAML variable: ${repositoryid}`);
            return repositoryid;
        }

        // This is a fallback to support TFS 2015
        return await this.getRepositoryIdFromBuildNumber(bldapi, name);
    }

    private async getRepositoryIdFromBuildNumber(bldapi: bld.IBuildApi, name: string): Promise<string> {
        let buildidVariable: string = `RELEASE.ARTIFACTS.${name}.BUILDID`;
        let buildid: string = tl.getVariable(buildidVariable);

        if (buildid !== null && buildid !== "") {
            let build: bldi.Build = await bldapi.getBuild(Number(buildid));
            tl.debug(`Got repositoryid from build: ${build.repository.id}`);
            return build.repository.id;
        }

        buildidVariable = `release.artifacts.${name}.buildId`;
        buildid = tl.getVariable(buildidVariable);

        if (buildid !== null && buildid !== "") {
            let build: bldi.Build = await bldapi.getBuild(Number(buildid));
            tl.debug(`Got repositoryid from YAML build: ${build.repository.id}`);
            return build.repository.id;
        }

        tl.setResult(tl.TaskResult.Failed, `Unable to get build id from variable: ${buildidVariable}`);
        return null;
    }

    protected async processArtifact(artifact: IArtifactData, gitapi: git.IGitApi) {
        tl.debug(`Processing artifact: '${artifact.name}' for ref: ${this.refName} new commit: ${artifact.commit}`);

        // Do this here instead of during population to avoid : https://github.com/jabbera/vsts-git-release-tag/issues/20
        await this.populateExistingRefCommit(artifact, this.refName, gitapi);

        tl.debug(`Old commit ${artifact.oldCommitId}`);

        // See if there is a matching ref for the same commit. We won't overwrite an existing ref. Done after the update so all refs don't need to be brought back every time.
        if (artifact.oldCommitId === artifact.commit) {
            tl.debug("Found matching ref for commit.");
            return true;
        }

        let localRefName: string = `refs/${this.refName}`;
        tl.debug(`Updating ref: ${localRefName}`);

        let updateResult: giti.GitRefUpdateResult = await this.updateRef(artifact, localRefName, gitapi);
        if (updateResult.success) {
            tl.debug("Ref updated!");
            return;
        }

        switch (updateResult.updateStatus) {
            case giti.GitRefUpdateStatus.CreateBranchPermissionRequired:
                tl.error(`${this.permissionTemplate}Create Branch`);
                break;
            case giti.GitRefUpdateStatus.CreateTagPermissionRequired:
                tl.error(`${this.permissionTemplate}Create Tag`);
                break;
        }

        tl.error(`If you need to change permissions see: _admin/_versioncontrol?_a=security&repositoryId=${artifact.repositoryId}`);

        tl.setResult(tl.TaskResult.Failed, `Unable to create ref: ${this.refName} UpdateStatus: ${updateResult.updateStatus} RepositoryId: ${updateResult.repositoryId} Old Commit: ${updateResult.oldObjectId} New Commit: ${updateResult.newObjectId}`);
    }
    private async populateExistingRefCommit(artifact: IArtifactData, refName: string, gitapi: git.IGitApi) {
        tl.debug(`Getting refs for: '${refName}' with repositoryId: '${artifact.repositoryId}'`);

        let refs: giti.GitRef[] = await gitapi.getRefs(artifact.repositoryId, null, refName);
        if (refs == null) {
            tl.debug(`No refs returned`);
            return;
        }

        tl.debug(`Got refs. Length = ${refs.length}`);
        let foundRef: giti.GitRef = refs.find((x) => x.name.endsWith(refName));
        if (foundRef == null) {
            return;
        }

        artifact.oldCommitId = foundRef.objectId;
    }
    private async updateRef(artifact: IArtifactData, refName: string, gitapi: git.IGitApi): Promise<giti.GitRefUpdateResult> {
        let ref: giti.GitRefUpdate = {
            "isLocked": false,
            "name": refName,
            "newObjectId": artifact.commit,
            "oldObjectId": artifact.oldCommitId,
            "repositoryId": artifact.repositoryId,
        };

        let refArray: giti.GitRefUpdate[] = [ref];
        let updateRefsResult: giti.GitRefUpdateResult[] = await gitapi.updateRefs(refArray, artifact.repositoryId);
        if (updateRefsResult == null || updateRefsResult.length === 0) {
            tl.warning(`No update result returned from updateRefs`);
            return null;
        }

        return updateRefsResult[0];
    }

    private printVersion() {
        try {
            let taskData = require("./task.json");
            console.log(`${taskData.name}: Version: ${taskData.version.Major}.${taskData.version.Minor}.${taskData.version.Patch}`);
        } catch (Err) {
            console.log("Unknown version number");
        }
    }
}