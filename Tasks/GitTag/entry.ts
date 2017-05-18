import * as vsts from "vso-node-api";
import * as git from "vso-node-api/GitApi";
import * as giti from "vso-node-api/Interfaces/GitInterfaces";
import * as tl from "vsts-task-lib/task";

async function run() {
    try {
        printVersion();

        let artifactData: IArtifactData[] = getAllGitArtifacts();

        let releaseName: string = tl.getVariable("RELEASE_RELEASENAME");
        let environmentName: string = tl.getVariable("RELEASE_ENVIRONMENTNAME");
        let tagName: string = `${releaseName}-${environmentName}`;


        let token: string = tl.getEndpointAuthorizationParameter("SystemVssConnection", "AccessToken", false);
        let collectionUrl: string = tl.getEndpointUrl("SystemVssConnection", false);
        let authHandler = vsts.getPersonalAccessTokenHandler(token);
        let connect = new vsts.WebApi(collectionUrl, authHandler);

        let api: git.IGitApi = connect.getGitApi();

        artifactData.forEach(async (artifact) => {
            let tag: giti.GitRefUpdate = {
                "isLocked": false,
                "name": tagName,
                "newObjectId": artifact.commit,
                "oldObjectId": "0000000000000000000000000000000000000000",
                "repositoryId": null,
            };

            let rua: giti.GitRefUpdate[] = [tag];
            let c: any = await api.updateRefs(rua, artifact.repositoryName, artifact.teamProjectName);
        });
    }
    catch (err) {
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

function getAllGitArtifacts(): IArtifactData[] {
    let artifactNames: IArtifactData[] = [];
    let regexp: RegExp = new RegExp("RELEASE_ARTIFACTS_(.*)_REPOSITORY_PROVIDER", "gi");

    Object.keys(process.env).forEach((x) => {
        let match: RegExpExecArray = regexp.exec(x);
        if (match === null) {
            return;
        }

        if (tl.getVariable(x) !== "TfsGit") {
            tl.debug(`Matching variable:  ${x}, but artifact type: ${process.env[x]}`);
            return;
        }

        let name: string = match[1];
        let artifact: IArtifactData = {
            "name": name,
            "commit": tl.getVariable(`RELEASE_ARTIFACTS_${name}_SOURCEVERSION`),
            "repositoryName": tl.getVariable(`RELEASE_ARTIFACTS_${name}_REPOSITORY_NAME`),
            "teamProjectName": tl.getVariable("SYSTEM_TEAMPROJECT"), // This is garbage. This variable is not provided currently so I assume it's all in 1.
        };

        artifactNames.push(artifact);
    });

    return artifactNames;
}

function printVersion() {
    try {
        let taskData = require("./task.json");
        console.log(`${taskData.name}: Version: ${taskData.version.Major}.${taskData.version.Minor}.${taskData.version.Patch}`);
    }
    catch (Err) {
        console.log("Unknown version number");
    }
}

run();