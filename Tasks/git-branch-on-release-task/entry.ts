import * as tl from "vsts-task-lib/task";
import * as grc from "./GitRefCreator";

class GitBranchCreator extends grc.GitRefCreator {
    readonly refName: string;

    constructor() {
        super();
        let prefix: string = "refs/heads";
        let branchFolder: string = tl.getInput("branchFolder", false);
        if (branchFolder != null && branchFolder.length > 0) {
            if (branchFolder[0] !== "/") {
                branchFolder = `/${branchFolder}`;
            }
            prefix = `${prefix}${branchFolder}`;
        }

        if (prefix[prefix.length - 1] !== "/") {
            prefix = `${prefix}/`;
        }

        this.refName = this.generateRef(tl.getVariable("RELEASE_RELEASENAME"), prefix);
    }
}

async function run() {
    let creator: GitBranchCreator = new GitBranchCreator();
    console.log("You must grant your build account the CreateBranch permission");
    await creator.run();
}

run();